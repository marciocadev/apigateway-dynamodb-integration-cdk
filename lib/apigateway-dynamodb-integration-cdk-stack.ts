import {
  AccessLogFormat,
  AwsIntegration,
  IntegrationOptions,
  IntegrationResponse,
  JsonSchema,
  JsonSchemaType,
  JsonSchemaVersion,
  LogGroupLogDestination,
  MethodLoggingLevel,
  Model,
  RequestValidator,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Aws, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

interface Constants {
  readonly TABLE_NAME: string;
  readonly LOG_GROUP_NAME: string;
  readonly API_NAME: string;
  readonly PARTITION_KEY: string;
  readonly SORT_KEY: string;
}

export class ApigatewayDynamodbIntegrationCdkStack extends Stack {
  private readonly constants: Constants = {
    TABLE_NAME: 'apigateway-dynamodb-integration-db',
    LOG_GROUP_NAME: '/aws/api-gateway/apigateway-dynamodb-integration',
    API_NAME: 'apigateway-dynamodb-integration',
    PARTITION_KEY: 'Artist',
    SORT_KEY: 'Album',
  };

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = this.createDynamoDBTable();
    const restApi = this.createRestApi();
    const apiGatewayRole = this.createApiGatewayRole(table);
    const requestValidator = this.createRequestValidator(restApi);

    this.setupPostAlbumEndpoint(restApi, table, apiGatewayRole, requestValidator);
    this.setupDeleteAlbumEndpoint(restApi, table, apiGatewayRole, requestValidator);
    this.setupGetAllAlbumsEndpoint(restApi, table, apiGatewayRole);
  }

  private createDynamoDBTable(): Table {
    return new Table(this, 'ApiGatewayDynamoDBIntegrationTable', {
      tableName: this.constants.TABLE_NAME,
      partitionKey: {
        name: this.constants.PARTITION_KEY,
        type: AttributeType.STRING,
      },
      sortKey: {
        name: this.constants.SORT_KEY,
        type: AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }

  private createRestApi(): RestApi {
    const logGroup = new LogGroup(this, 'ApigatewayLogGroup', {
      logGroupName: this.constants.LOG_GROUP_NAME,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    return new RestApi(this, 'ApigatewayDynamoDBRestApi', {
      restApiName: this.constants.API_NAME,
      deployOptions: {
        tracingEnabled: true,
        loggingLevel: MethodLoggingLevel.INFO,
        accessLogDestination: new LogGroupLogDestination(logGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
    });
  }

  private createApiGatewayRole(table: Table): Role {
    const role = new Role(this, 'ApigatewayDynamoDBRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });

    table.grantFullAccess(role);

    role.addToPolicy(
      new PolicyStatement({
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      }),
    );

    return role;
  }

  private createRequestValidator(restApi: RestApi): RequestValidator {
    return new RequestValidator(this, 'RequestValidator', {
      requestValidatorName: 'apigateway-dynamodb-validator',
      restApi,
      validateRequestBody: true,
      validateRequestParameters: true,
    });
  }

  private createErrorIntegrationResponses(): IntegrationResponse[] {
    return [
      {
        statusCode: '400',
        selectionPattern: '400',
        responseTemplates: {
          'application/json': '{\n  "error": "Bad input!"\n}',
        },
      },
      {
        statusCode: '500',
        selectionPattern: '5\\d{2}',
        responseTemplates: {
          'application/json': '{\n  "error": "Internal Service Error!"\n}',
        },
      },
    ];
  }

  private createPostRequestModel(restApi: RestApi): Model {
    const schema: JsonSchema = {
      title: 'PostAlbumSchema',
      type: JsonSchemaType.OBJECT,
      schema: JsonSchemaVersion.DRAFT4,
      properties: {
        artist: { type: JsonSchemaType.STRING },
        album: { type: JsonSchemaType.STRING },
        tracks: {
          type: JsonSchemaType.ARRAY,
          items: {
            type: JsonSchemaType.OBJECT,
            properties: {
              title: { type: JsonSchemaType.STRING },
              length: { type: JsonSchemaType.STRING },
            },
          },
        },
      },
      required: ['artist', 'album'],
    };

    return new Model(this, 'PostAlbumModel', {
      restApi,
      contentType: 'application/json',
      schema,
    });
  }

  private createPostIntegrationOptions(table: Table, apiGatewayRole: Role): IntegrationOptions {
    return {
      credentialsRole: apiGatewayRole,
      requestTemplates: {
        'application/json': this.buildPostRequestTemplate(table.tableName),
      },
      integrationResponses: [
        {
          statusCode: '204',
          responseTemplates: {
            'application/json': '$context.requestId',
          },
        },
        ...this.createErrorIntegrationResponses(),
      ],
    };
  }

  private buildPostRequestTemplate(tableName: string): string {
    return `{
  "TableName": "${tableName}",
  "Item": {
    "Artist": { "S": "$input.path('$.artist')" },
    "Album": { "S": "$input.path('$.album')" }
    #if($input.path('$.tracks') && $input.path('$.tracks').size() > 0)
    ,"Tracks": {
      "L": [
        #foreach($track in $input.path('$.tracks'))
        {
          "M": {
            "Title": { "S": "$track.title" },
            "Length": { "S": "$track.length" }
          }
        }#if($foreach.hasNext),#end
        #end
      ]
    }
    #end
  }
}`;
  }

  private setupPostAlbumEndpoint(
    restApi: RestApi,
    table: Table,
    apiGatewayRole: Role,
    requestValidator: RequestValidator,
  ): void {
    const albumResource = restApi.root.addResource('album');
    const postModel = this.createPostRequestModel(restApi);
    const integrationOptions = this.createPostIntegrationOptions(table, apiGatewayRole);

    const integration = new AwsIntegration({
      service: 'dynamodb',
      region: Aws.REGION,
      action: 'PutItem',
      options: integrationOptions,
    });

    albumResource.addMethod('POST', integration, {
      methodResponses: [
        { statusCode: '204' },
        { statusCode: '400' },
        { statusCode: '500' },
      ],
      requestModels: { 'application/json': postModel },
      requestValidator,
    });
  }

  private createDeleteIntegrationOptions(table: Table, apiGatewayRole: Role): IntegrationOptions {
    return {
      credentialsRole: apiGatewayRole,
      requestTemplates: {
        'application/json': this.buildDeleteRequestTemplate(table.tableName),
      },
      integrationResponses: [
        {
          statusCode: '200',
          responseTemplates: {
            'application/json': this.buildDeleteResponseTemplate(),
          },
        },
        ...this.createErrorIntegrationResponses(),
      ],
    };
  }

  private buildDeleteRequestTemplate(tableName: string): string {
    return `{
  "TableName": "${tableName}",
  "Key": {
    "Artist": { "S": "$util.urlDecode($method.request.path.artist)" },
    "Album": { "S": "$util.urlDecode($method.request.path.album)" }
  },
  "ReturnValues": "ALL_OLD"
}`;
  }

  private buildDeleteResponseTemplate(): string {
    return `#set($artist = $input.path('$.Attributes.Artist.S'))
#if($artist && "$artist" != "")
{
  "artist": "$input.path('$.Attributes.Artist.S')",
  "album": "$input.path('$.Attributes.Album.S')"
}
#else
#set($context.responseOverride.status = 404)
{
  "error": "Registro não existe no banco de dados",
  "message": "O artista '$util.urlDecode($method.request.path.artist)' e o álbum '$util.urlDecode($method.request.path.album)' não foram encontrados na tabela"
}
#end`;
  }

  private setupDeleteAlbumEndpoint(
    restApi: RestApi,
    table: Table,
    apiGatewayRole: Role,
    requestValidator: RequestValidator,
  ): void {
    const deleteResource = restApi.root.addResource('{artist}').addResource('{album}');
    const integrationOptions = this.createDeleteIntegrationOptions(table, apiGatewayRole);

    const integration = new AwsIntegration({
      service: 'dynamodb',
      region: Aws.REGION,
      action: 'DeleteItem',
      options: integrationOptions,
    });

    deleteResource.addMethod('DELETE', integration, {
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '404' },
        { statusCode: '400' },
        { statusCode: '500' },
      ],
      requestValidator,
      requestParameters: {
        'method.request.path.artist': true,
        'method.request.path.album': true,
      },
    });
  }

  private createGetAllAlbumsIntegrationOptions(
    table: Table,
    apiGatewayRole: Role,
  ): IntegrationOptions {
    return {
      credentialsRole: apiGatewayRole,
      requestTemplates: {
        'application/json': `{ "TableName": "${table.tableName}" }`,
      },
      integrationResponses: [
        {
          statusCode: '200',
          responseTemplates: {
            'application/json': this.buildGetAllAlbumsResponseTemplate(),
          },
        },
        ...this.createErrorIntegrationResponses(),
      ],
    };
  }

  private buildGetAllAlbumsResponseTemplate(): string {
    return `[
#foreach($item in $input.path('$.Items'))
{
  "artist": "$item.Artist.S",
  "album": "$item.Album.S",
  #if($item.Tracks && $item.Tracks.L)
  "tracks": [
    #foreach($track in $item.Tracks.L)
    {
      "title": "$track.M.Title.S",
      "length": "$track.M.Length.S"
    }#if($foreach.hasNext),#end
    #end
  ]
  #else
  "tracks": []
  #end
}#if($foreach.hasNext),#end
#end
]`;
  }

  private setupGetAllAlbumsEndpoint(
    restApi: RestApi,
    table: Table,
    apiGatewayRole: Role,
  ): void {
    const integrationOptions = this.createGetAllAlbumsIntegrationOptions(table, apiGatewayRole);

    const integration = new AwsIntegration({
      service: 'dynamodb',
      region: Aws.REGION,
      action: 'Scan',
      options: integrationOptions,
    });

    restApi.root.addMethod('GET', integration, {
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
        { statusCode: '500' },
      ],
    });
  }
}
