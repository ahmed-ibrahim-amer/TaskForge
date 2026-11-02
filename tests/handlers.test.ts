/// <reference types="jest" />

import { runJob } from '../src/handlers';
import { Job, PrismaClient } from '@prisma/client';

const fakePrisma = {} as PrismaClient;

function emailJob(payload: string): Job {
    return {
        id: 'job-1',
        type: 'EMAIL_BATCH',
        payload
    } as unknown as Job;
}

describe('EMAIL_BATCH handler', () => {

    it('sends to every recipient', async () => {
        const payload = JSON.stringify({
            recipients: ['a@x.com', 'b@x.com'],
            subject: 'Hi',
            message: 'Hello',
        });

        const result = await runJob(fakePrisma, emailJob(payload));

        expect(result).toEqual({ sent: 2 });
    });

    it('rejects a payload that is not JSON', async () => {
        await expect(
            runJob(fakePrisma, emailJob('hello'))
        ).rejects.toThrow('EMAIL_BATCH payload must be JSON text');
    });

    it('rejects more than 1000 recipients', async () => {
        const recipients = Array.from(
            { length: 1001 },
            (_, i) => `u${i}@x.com`
        );

        const payload = JSON.stringify({
            recipients,
            subject: 'Hi',
            message: 'Hello',
        });

        await expect(
            runJob(fakePrisma, emailJob(payload))
        ).rejects.toThrow('Too many recipients (max 1000)');
    });

});