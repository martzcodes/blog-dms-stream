import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceFailedResponse,
  CloudFormationCustomResourceSuccessResponse,
} from 'aws-lambda';

import { getConnectionPool } from './utils/connection';

export const handler = async (
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceSuccessResponse | CloudFormationCustomResourceFailedResponse> => {
  switch (event.RequestType) {
    case 'Create':
      try {
        const connection = await getConnectionPool();

        const randomNumber = Math.floor(Math.random() * 1000);
        await connection.query(`INSERT INTO ${process.env.DB_NAME}.${process.env.TABLE_NAME} (example) VALUES ('hello ${randomNumber}');`);

        return { ...event, PhysicalResourceId: `seed-db`, Status: 'SUCCESS' };
      } catch (e) {
        console.error(`seed failed!`, e);
        return { ...event, PhysicalResourceId: `seed-db`, Reason: (e as Error).message, Status: 'FAILED' };
      }
    default:
      console.error('No op for', event.RequestType);
      return { ...event, PhysicalResourceId: 'seed-db', Status: 'SUCCESS' };
  }
};