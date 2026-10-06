import { PrismaClient } from '@prisma/client';
import boss from './queue';


const prisma = new PrismaClient();

export function startWorker() {
    boss.work('process-job', async ([job]) => {
    const { jobId } = job.data as { jobId: string };
    try {
        console.log(`Processing job: ${jobId}`);

        const jobData = await prisma.job.findUnique({where:{id: jobId}});

            if(String(jobData?.payload).includes("fail")){
                throw new Error("Simulated failure for testing");
            }
        // Step 1: mark as RUNNING
        await prisma.job.update({
            where: { id: jobId },
            data: { status: 'RUNNING' },
        });

        // Step 2: fake work (pretend it takes some time)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Step 3: mark as COMPLETED
        await prisma.job.update({
            where: { id: jobId },
            data: { status: 'COMPLETED' },
        });
        //Job Log row
        await prisma.jobLog.create({
            data:{
                jobId:jobId,
                attempt:(jobData?.retryCount ?? 0) + 1,//This will improve
                status:"SUCCESS",
            }
        });
        console.log(`Job completed: ${jobId}`);
    }catch (error) {
    console.error(`Job failed: ${jobId}`, error);

    const MAX_RETRIES = 2;

    // Step 1: increase retryCount
    const updatedJob = await prisma.job.update({
        where: { id: jobId },
        data: { retryCount: { increment: 1 } },
    });

    // Step 2: decide — is this the last allowed attempt?
    const isLastAttempt = updatedJob.retryCount > MAX_RETRIES;

    // Step 3: update status accordingly
    await prisma.job.update({
        where: { id: jobId },
        data: { status: isLastAttempt ? 'FAILED' : 'PENDING' },
    });

    // Step 4: log this failed attempt
    await prisma.jobLog.create({
        data: {
            jobId: jobId,
            attempt: updatedJob.retryCount,
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
    });

    throw error; // re-throw so pg-boss knows to retry (if not maxed out)
}
    });

    console.log('👷 Worker is listening for jobs');
}

