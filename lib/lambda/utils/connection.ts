import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { PoolConfig } from 'mysql';
import { createPool, Pool } from 'promise-mysql';

const sm = new SecretsManagerClient({ region: 'us-east-1' });

const sleep = async (timeout: number) => new Promise((resolve) => setTimeout(resolve, timeout));

export const getConnectionPool = async (dbName?: string, retries = 0): Promise<Pool> => {
  try {
    const { password, dbname: database, host, username: user } = await getDbDetails();
    const poolConfig: PoolConfig = {
      database: dbName || database,
      host,
      connectionLimit: 100,
      multipleStatements: true,
      password,
      user,
    };
    const pool = await createPool(poolConfig);
    return await checkConnection(pool, retries, dbName);
  } catch (e) {
    console.error('An error occurred while creating a connection pool: ', (e as Error).message);
    throw e;
  }
};

const checkConnection = async (connection: Pool, retries: number, dbName?: string): Promise<Pool> => {
  if (retries > 2) {
    throw new Error('Could not connect!');
  }
  try {
    await connection.query('select 1');
    return connection;
  } catch {
    console.log(`Couldn't connect on try #${++retries}`);
    await sleep(retries * 10000);
    return checkConnection(await getConnectionPool(dbName, retries), retries, dbName);
  }
};

const getDbDetails = async (): Promise<{ dbname: string; host: string; password: string; username: string }> => {
  const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN }));
  if (!SecretString) {
    throw new Error('Unable to fetch secret!');
  }
  return JSON.parse(SecretString);
};