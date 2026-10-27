import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { PrismaClient, JobType } from '@prisma/client';
import {startBoss} from './queue';
import boss from './queue';
import dotenv from 'dotenv';
import { startWorker } from './worker';
import { JobStatus } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();



interface MyContext{
    prisma: PrismaClient;
    user:{ id: string , role: string } | null;
}
interface RegisterArgs {
    email: string;
    password: string;
}
interface LoginArgs {
    email: string;
    password: string;
}
interface CreateJobArgs {
    type: JobType;
    payload: string;
}
interface JobIdArgs {
    id: string;
}
interface AllJobsArgs {
    status?:JobStatus;
}

interface CreateRecurringJobArgs {
    cron:string;
    type : JobType;
    payload:string;
}
const createToken = (id: string, role: string): string => {
    return jwt.sign({id,role},process.env.SECRET_TOKEN_KEY as string,{
        expiresIn:"50m"
    });
};


const typeDefs = `#graphql
    type Query {
        hello: String,
        myJobs:[Job],
        job(id: String): Job
        allJobs(status:JobStatus):[Job]
    }
    type Mutation {
        register(email: String, password: String): AuthPayload
        login(email: String, password: String): AuthPayload
        createJob(type: JobType, payload: String): Job
        retryJob(id: String): Job
        createRecurringJob(cron: String, type: JobType, payload: String): RecurringJob
    }
    type User {
        id:String,
        email:String
    }
    type AuthPayload {
        token: String,
        user: User
    }
    type RecurringJob {
        id: String
        cron: String
        type: JobType
        createdAt: String
    }
    enum JobType {
        REPORT
        EMAIL_BATCH
        DATA_EXPORT
    }
    enum JobStatus {
        PENDING
        RUNNING
        COMPLETED
        FAILED
    }
    enum LogStatus {
        SUCCESS
        FAILED
    }
    type Job {
        id: String
        type: JobType
        retryCount: Int
        status: JobStatus
        result: String
        logs: [JobLog]
        createdAt: String
    }
    type JobLog {
        id: String
        attempt: Int
        status: LogStatus
        errorMessage: String
        createdAt: String
    }

`;

const resolvers = {
    Query:{
        hello:  () => "hello string" ,
        myJobs: async (parent: unknown, args: unknown, context: MyContext) => {
            if (!context.user) {
                    throw new Error('You must be logged in');
            }
            const jobs = await context.prisma.job.findMany({
                where:{userId : context.user.id }
            });
            return jobs;
    } ,
    job : async(parent:unknown , args:JobIdArgs , context: MyContext)=>{
            if (!context.user) {
                        throw new Error('You must be logged in');
                };
        const job = await context.prisma.job.findUnique({
            where: {id: args.id}
        });    
            if(!job){
                throw new Error("Job not found");
            }
            if(job.userId !== context.user.id && context.user.role !== "ADMIN"){
                throw new Error("You dont have Authorization to see this view");
            }
        return job
    },
    allJobs :  async(parent:unknown , args: AllJobsArgs, context:MyContext)=>{
        if(!context.user){
            throw new Error("You must be logged in")
        }
        if(context.user.role !== "ADMIN"){
                throw new Error("You don't have permission to view all jobs");
        }
        const jobs = await context.prisma.job.findMany({
            where: { status: args.status },
            orderBy:{createdAt :"desc"}
        })
        return jobs;
    }
    },
    Mutation: {
        register: async(parent: unknown , args: RegisterArgs , context: MyContext) => {

            const {email , password} = args;
            
            const existingUser = await context.prisma.user.findUnique({where :{ email }});
                if (existingUser) {
                    throw new Error('Email already in use');
                }
            const hashedPassword = await bcrypt.hash(password , 12); 
            
            const user = await context.prisma.user.create(
                { 
                data: {
                    email,
                    password: hashedPassword
                }
            });
            const token = createToken(user.id,user.role);
            return {user , token};
    },
    login: async (parent: unknown , args: LoginArgs , context: MyContext) =>{
        const { email ,password } = args;

        const user = await context.prisma.user.findUnique({where:{email}});
            if(!user){
                throw new Error('Invalid email or password');
            }
        const isValid = await bcrypt.compare(password,user.password);
            if(!isValid){
                throw new Error('Invalid email or password');
            }
        const token = createToken(user.id, user.role);

        return { user, token };    
    },
    createJob: async(parent :unknown  , args:CreateJobArgs , context:MyContext ) => {
            if(!context.user){
                throw new Error("You must be logged in")
            }
            
        const job = await context.prisma.job.create({
            data: {
            type: args.type,
            payload: args.payload,
            userId: context.user.id,
            },
        });
        await boss.send('process-job', {jobId: job.id },{ retryLimit: 2 }) //boss.send take three argument 1.queue name 2.data 3.options
        return job;
    },
    retryJob: async (parent:unknown , args: JobIdArgs , context:MyContext) =>{
        if(!context.user){
            throw new Error("You must be logged in");
        }
        const job = await context.prisma.job.findUnique({
            where:{id: args.id},
        });

        if(!job){
                throw new Error("Job not found");
            }

            if(job.userId !== context.user.id && context.user.role !== "ADMIN"){
                throw new Error("You don't have permission to retry this job");
            }

            if(job.status !== "FAILED"){
                throw new Error("Only failed jobs can be retried");
            }

        const updatedJob = await context.prisma.job.update({
            where: { id: args.id },
            data: {
                status: 'PENDING',
                retryCount: 0,
            },
    });
    await boss.send("process-job"  ,{jobId: job.id} , {retryLimit: 2});

    return updatedJob;
    },
    createRecurringJob:async (parent:unknown , args:CreateRecurringJobArgs , context:MyContext)=>{
        if(!context.user){
            throw new Error("You must be logged in")
        }
        if(context.user.role !== "ADMIN"){
            throw new Error("You don't have permission to create recurring jobs");
        }
        const recurringJob = await context.prisma.recurringJob.create({
            data: {
                cron: args.cron,
                type: args.type,
                payload: args.payload,
                createdById: context.user.id,
            },
    });
        try{
            await boss.schedule(
                'recurring-job',
                args.cron,
                {recurringJobId: recurringJob.id},
                {key:recurringJob.id, tz :'UTC'}
            );
        }catch(error){
            await context.prisma.recurringJob.delete({ where: { id: recurringJob.id } });
            throw error;
        }
        return recurringJob;
    }
    },
    Job: {
        //this is responsible for convert result value to text
        result:(parent : {result: unknown})=>
            parent.result == null ? null: JSON.stringify(parent.result),

        createdAt: (parent: { createdAt: Date | null }) =>
        parent.createdAt ? parent.createdAt.toISOString() : null,

        logs:(parent: {id: string}, args: unknown , context:MyContext)=>{
            return  context.prisma.jobLog.findMany({
                where:{jobId :parent.id},
                orderBy:{createdAt:'asc'}
            });
        }       
    },
    JobLog:{ createdAt: (parent: { createdAt: Date | null }) =>
        parent.createdAt ? parent.createdAt.toISOString() : null
},
    RecurringJob: {
        createdAt: (parent: { createdAt: Date | null }) =>
        parent.createdAt ? parent.createdAt.toISOString() : null,
    },
}

//create new server
const server = new ApolloServer<MyContext>({typeDefs , resolvers});
async function start(){
    
    await startBoss();
    startWorker();
const {url} = await startStandaloneServer(server, 
{ 
    listen:{ port:4000 },
    context: async ({req}): Promise<MyContext> =>{
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        let user: MyContext['user'] = null;

        try{
            user = jwt.verify(token , process.env.SECRET_TOKEN_KEY as string) as MyContext['user'];
        }catch(error){
            user = null
        }
        return {user , prisma};
    }, 
});
    console.log(`🚀 Server ready at ${url}`);
}
start();