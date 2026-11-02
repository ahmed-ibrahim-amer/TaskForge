
import jwt from 'jsonwebtoken';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { PrismaClient, JobType } from '@prisma/client';
import {startBoss} from './queue';
import dotenv from 'dotenv';
import { startWorker } from './worker';
import { typeDefs , resolvers , MyContext } from './Schema';

dotenv.config();

const prisma = new PrismaClient();


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