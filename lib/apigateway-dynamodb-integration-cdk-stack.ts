import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

export class ApigatewayDynamodbIntegrationCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new Table(this, "table", {
      tableName: "apigateway-dynamodb-integration-db",
      partitionKey: {
        name: "Artist",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "Album",
        type: AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
