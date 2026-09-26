import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { Prisma, PrismaClient, User } from '@prisma/client';
import {startBoss} from './queue';

import dotenv from 'dotenv';

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
interface AddJobArgs {
    name: string;
}


const createToken = (id: string, role: string): string => {
    return jwt.sign({id,role},process.env.SECRET_TOKEN_KEY as string,{
        expiresIn:"50m"
    });
};


const typeDefs = `#graphql
    type Query {
        hello: String,
        jobs: [String]
    }
    type Mutation {
        addJob(name: String): String
        register(email: String, password: String): AuthPayload
        login(email: String, password: String): AuthPayload
    }
    type User {
        id:String,
        email:String
    }
    type AuthPayload {
        token: String,
        user: User
    }
`;

let jobsList : string[] = ["job A" , "job B"];

const resolvers = {
    Query:{
        hello:  () => "hello string" ,
        jobs: ()=> jobsList  
    },
    Mutation: {
        addJob(parent:unknown , args:AddJobArgs , context:MyContext){
            if(!context.user){
                throw new Error('You must be logged in');
            }
            jobsList.push(args.name);
            return args.name;
        },
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
    }
    }
}

//create new server
const server = new ApolloServer<MyContext>({typeDefs , resolvers});
async function start(){
    await startBoss();
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