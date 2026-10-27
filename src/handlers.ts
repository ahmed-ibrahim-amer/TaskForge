import { PrismaClient, Prisma, Job } from '@prisma/client';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runJob(prisma: PrismaClient, job: Job): Promise < Prisma.InputJsonValue > {
    switch(job.type){
        case 'REPORT':
            return generateReport(prisma ,job);
        case 'DATA_EXPORT':
            return exportData(prisma,job);
        case 'EMAIL_BATCH':
            return sendEmails(job);
        default:
            throw new Error(`Unknown job type: ${job.type}`);           
    }
}

async function generateReport(prisma:PrismaClient , job: Job){
    const grouped = await prisma.job.groupBy({
        by:['status'],
        where:{userId: job.id},
        _count:{_all : true}
    });

    //here we will make empty Object to store every status with her number
    const byStatus : Record<string , number> = {}; // <string , number>  This mean typescript his mean is the object will contain key and value
    let total = 0;

    for (const g of grouped){
        byStatus[g.status] = g._count._all; //byStatus[g.status] This mean the name of status g._count._all number of status
        total += g._count._all;
    }
    
    return {
        generatedAt: new Date().toISOString(),
        totalJobs: total,
        byStatus
    }
}

function csvCell(value: unknown):string {  // this function will take kind of value , string will return text 
    let text = String(value ?? '');
    if(/^=+\-@/.test(text))text=`${text}`
    return `"${text.replace(/"/g, '""')}"`;
}

async function exportData(prisma: PrismaClient , job: Job) {
    //read records from database .1
    const jobs = await prisma.job.findMany({
        where:{userId: job.userId},
        orderBy: {createdAt: 'asc'}
    });
    // make address for rows .2 
    let lines = ['id,type,status,retryCount,createdAt'];

    //convert every record to row
    for(const j of jobs){
        lines.push(
            [
            j.id,
            j.type,
            j.status,
            j.retryCount,
            j.createdAt.toISOString()
        ].map(csvCell) 
        .join(',')
        );
    }
    await fs.mkdir("exports" , {recursive:true}); // fs.mkdir => create file  "exports" => name of this file {recursive:true}=> solve if path have any wrong or not found
    const file = path.join("exports" ,`${job.id}.csv`) //`${job.id}.csv` this make file name using job like abc123.csv
    //.join("exports" ,`${job.id}.csv`) that identify path file inside exports
    await fs.writeFile(file,lines.join("\n"),'utf8');
    return {file , rows: jobs.length};// return export result.
}

async function sendEmails(job: Job) {
    let data: {
        recipients: string[];
        subject: string;
        message: string
    }

    try{
        data = JSON.parse(String(job.payload));
    }catch{
        throw new Error('EMAIL_BATCH payload must be JSON text');
    }
    if (!Array.isArray(data.recipients) || !data.subject || !data.message) {
        throw new Error('EMAIL_BATCH needs recipients, subject and message');
    }
    if (data.recipients.length > 1000) {
        throw new Error('Too many recipients (max 1000)');
    }
    for (const to of data.recipients) {
        console.log(`[FAKE EMAIL] to=${to} subject="${data.subject}"`);
    }
return { sent: data.recipients.length };
};




