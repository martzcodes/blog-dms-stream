import type { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';

export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  for (let j = 0; j < event.Records.length; j++) {
    const record: KinesisStreamRecord = event.Records[j];
    console.log(JSON.stringify({record}));
    const payload = Buffer.from(record.kinesis.data, 'base64').toString('ascii');
    console.log('Decoded payload:', payload);
    const parsed = JSON.parse(payload);
    console.log(JSON.stringify({parsed}, null, 2));
  }
};