# Aurora MySQL Change Data Capture Stream to Kinesis with before and after data

This is the example code for a blog post on https://matt.martz.codes

# ⚠️ USE AT YOUR OWN RISK ⚠️

This CDK project will deploy two stacks.  An DatabaseStack which includes a small Aurora MySQL instance with enhanced binlog enabled, and a DMS stack that includes a DMS change data capture replication to kinesis.

- `npm install`
- `npx cdk deploy --all`

Once deployed, DMS will automatically have its replication task started via the Custom Resources.  To see the changes in action you can manually invoke the `seed` lambda and view the output in the `kinesis-stream` lambda.

***There is a cost associated with this project.***  When finished run `npx cdk destroy --all --force` and ensure that the two stacks are cleaned up in your account.