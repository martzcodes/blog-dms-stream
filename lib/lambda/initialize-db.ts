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

        await connection.query(
          "CALL mysql.rds_set_configuration('binlog retention hours', 24);"
        );

        await connection.query(`DROP TABLE IF EXISTS ${process.env.DB_NAME}.${process.env.TABLE_NAME};`);
        await connection.query(`CREATE TABLE ${process.env.DB_NAME}.${process.env.TABLE_NAME} (id INT NOT NULL AUTO_INCREMENT, example VARCHAR(255) NOT NULL, PRIMARY KEY (id));`);
        
        return { ...event, PhysicalResourceId: `init-db`, Status: 'SUCCESS' };
      } catch (e) {
        console.error(`initialization failed!`, e);
        return { ...event, PhysicalResourceId: `init-db`, Reason: (e as Error).message, Status: 'FAILED' };
      }
    default:
      console.error('No op for', event.RequestType);
      return { ...event, PhysicalResourceId: 'init-db', Status: 'SUCCESS' };
  }
};