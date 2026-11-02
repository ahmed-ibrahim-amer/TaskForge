import { ApolloServer } from '@apollo/server';
import { PrismaClient } from '@prisma/client';
import {typeDefs , resolvers , MyContext} from '../src/Schema';
import { unschedule } from 'pg-boss/dist/plans';



jest.mock("../src/queue",()=>({
    __esModule: true, //make jest work with module like ES Module
    default: {
        send: jest.fn(),
        schedule: jest.fn(),
        unschedule: jest.fn()
    },
    startBoss: jest.fn(),
}));


import boss from '../src/queue';

const server = new ApolloServer<MyContext>({
    typeDefs,
    resolvers
});

const fake = (obj: Object) => obj as unknown as PrismaClient;//that will take  normal object and convert it from typescript into PrismaClient we dong need real dataBase

async function run(query:string , ctx: Partial<MyContext>){// we used Partial to make fields  is Opetional not requried
    const res = await server.executeOperation(
        {query},
        { contextValue: {prisma: fake({}) , user:null , ...ctx }}
    );
    if (res.body.kind !== 'single') throw new Error('unexpected response');
    return res.body.singleResult;
}
const admin = {user: {id: 'u1' ,role: 'ADMIN' }};
const normal = {user:{id:"u2" , role:"USER"}};

beforeEach(()=> jest.clearAllMocks());

describe('allJobs', () => {
    it('needs login', async () => {
        const r = await run('{ allJobs { id } }', {});
        expect(r.errors?.[0].message).toBe('You must be logged in');
    });

    it('blocks a normal user', async () => {
        const r = await run('{ allJobs { id } }', normal);
        expect(r.errors?.[0].message).toBe("You don't have permission to view all jobs");
    });

    it('lets an admin see jobs', async () => {
        const prisma = fake({ job: { findMany: jest.fn().mockResolvedValue([{ id: 'j1' }]) } });
        const r = await run('{ allJobs { id } }', { ...admin, prisma });
        expect(r.errors).toBeUndefined();
        expect(r.data).toEqual({ allJobs: [{ id: 'j1' }] });
    });
});

describe('retryJob', () => {
    const mutation = 'mutation { retryJob(id: "j1") { id status } }';

    it('only retries FAILED jobs', async () => {
        const prisma = fake({
            job: { findUnique: jest.fn().mockResolvedValue({ id: 'j1', userId: 'u2', status: 'COMPLETED' }) },
        });
        const r = await run(mutation, { ...normal, prisma });
        expect(r.errors?.[0].message).toBe('Only failed jobs can be retried');
        expect(boss.send).not.toHaveBeenCalled();
    });

    it("blocks another user's job", async () => {
        const prisma = fake({
            job: { findUnique: jest.fn().mockResolvedValue({ id: 'j1', userId: 'someone-else', status: 'FAILED' }) },
        });
        const r = await run(mutation, { ...normal, prisma });
        expect(r.errors?.[0].message).toBe("You don't have permission to retry this job");
    });

    it('resets the job and sends it to pg-boss', async () => {
        const prisma = fake({
            job: {
                findUnique: jest.fn().mockResolvedValue({ id: 'j1', userId: 'u2', status: 'FAILED' }),
                update: jest.fn().mockResolvedValue({ id: 'j1', status: 'PENDING' }),
            },
        });
        const r = await run(mutation, { ...normal, prisma });
        expect(r.errors).toBeUndefined();
        expect(boss.send).toHaveBeenCalledWith('process-job', { jobId: 'j1' }, { retryLimit: 2 });
    });
});

// YOUR TEST: createJob (logged in) must call
// boss.send('process-job', { jobId: ... }, { retryLimit: 2 })
// Hint: mock prisma.job.create to return { id: 'j9' }
// Query: mutation { createJob(type: REPORT, payload: "x") { id } }