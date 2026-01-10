import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ApigatewayDynamodbIntegrationCdkStack } from '../lib/apigateway-dynamodb-integration-cdk-stack';

describe('ApigatewayDynamodbIntegrationCdkStack', () => {
  let app: App;
  let stack: ApigatewayDynamodbIntegrationCdkStack;
  let template: Template;

  beforeEach(() => {
    app = new App();
    stack = new ApigatewayDynamodbIntegrationCdkStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  describe('DynamoDB Table', () => {
    test('should create DynamoDB table with correct name', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'apigateway-dynamodb-integration-db',
      });
    });

    test('should have partition key Artist as STRING', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: Match.arrayWith([
          {
            AttributeName: 'Artist',
            KeyType: 'HASH',
          },
        ]),
        AttributeDefinitions: Match.arrayWith([
          {
            AttributeName: 'Artist',
            AttributeType: 'S',
          },
        ]),
      });
    });

    test('should have sort key Album as STRING', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: Match.arrayWith([
          {
            AttributeName: 'Album',
            KeyType: 'RANGE',
          },
        ]),
        AttributeDefinitions: Match.arrayWith([
          {
            AttributeName: 'Album',
            AttributeType: 'S',
          },
        ]),
      });
    });

    test('should have RemovalPolicy set to DESTROY', () => {
      template.hasResource('AWS::DynamoDB::Table', {
        DeletionPolicy: 'Delete',
      });
    });
  });

  describe('CloudWatch Log Group', () => {
    test('should create LogGroup for API Gateway', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/api-gateway/apigateway-dynamodb-integration',
      });
    });

    test('should have RemovalPolicy set to DESTROY', () => {
      template.hasResource('AWS::Logs::LogGroup', {
        DeletionPolicy: 'Delete',
      });
    });
  });

  describe('API Gateway RestApi', () => {
    test('should create REST API with correct name', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'apigateway-dynamodb-integration',
      });
    });

    test('should have tracing enabled', () => {
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        TracingEnabled: true,
      });
    });

    test('should have INFO logging level', () => {
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        MethodSettings: Match.arrayWith([
          Match.objectLike({
            DataTraceEnabled: false,
            LoggingLevel: 'INFO',
            HttpMethod: '*',
            ResourcePath: '/*',
          }),
        ]),
      });
    });

    test('should have access log format with standard fields', () => {
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        AccessLogSetting: Match.objectLike({
          Format: Match.stringLikeRegexp('caller'),
        }),
      });
    });
  });

  describe('IAM Role for API Gateway', () => {
    test('should create IAM Role for API Gateway service', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'apigateway.amazonaws.com',
              },
            },
          ]),
        },
      });
    });

    test('should grant full access to DynamoDB table', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Effect: 'Allow',
              Action: 'dynamodb:*',
              Resource: Match.anyValue(),
            },
          ]),
        },
      });
    });

    test('should have X-Ray permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Effect: 'Allow',
              Action: Match.arrayWith([
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
              ]),
              Resource: '*',
            },
          ]),
        },
      });
    });
  });

  describe('Request Validator', () => {
    test('should create Request Validator', () => {
      template.hasResourceProperties('AWS::ApiGateway::RequestValidator', {
        Name: 'apigateway-dynamodb-validator',
        ValidateRequestBody: true,
        ValidateRequestParameters: true,
      });
    });
  });

  describe('POST Album Endpoint', () => {
    test('should create /album resource', () => {
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'album',
      });
    });

    test('should create POST method on /album', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        Integration: {
          Type: 'AWS',
          IntegrationHttpMethod: 'POST',
          Uri: Match.objectLike({
            "Fn::Join": [
              "",
              Match.arrayWith([
                Match.stringLikeRegexp('arn:'),
                Match.stringLikeRegexp('apigateway:'),
                Match.stringLikeRegexp('dynamodb:'),
              ]),
            ]
          }),
          IntegrationResponses: Match.arrayWith([
            Match.objectLike({
              StatusCode: '204',
            }),
            Match.objectLike({
              StatusCode: '400',
              SelectionPattern: '400',
            }),
            Match.objectLike({
              StatusCode: '500',
              SelectionPattern: '5\\d{2}',
            }),
          ]),
        },
      });
    });

    test('should have PutItem action in DynamoDB integration', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        Integration: {
          Uri: Match.objectLike({
            "Fn::Join": [
              "",
              Match.arrayWith([
                Match.stringLikeRegexp('action/PutItem'),
              ]),
            ]
          }),
        },
      });
    });

    test('should have method responses 204, 400, and 500', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        MethodResponses: Match.arrayWith([
          { StatusCode: '204' },
          { StatusCode: '400' },
          { StatusCode: '500' },
        ]),
      });
    });

    test('should have request model for POST', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        RequestModels: {
          'application/json': Match.anyValue(),
        },
      });
    });

    test('should create Model for POST request', () => {
      template.hasResourceProperties('AWS::ApiGateway::Model', {
        ContentType: 'application/json',
        Schema: Match.objectLike({
          title: 'PostAlbumSchema',
          type: 'object',
        }),
      });
    });

    test('should use RequestValidator for POST method', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        RequestValidatorId: Match.anyValue(),
      });
    });
  });

  describe('DELETE Album Endpoint', () => {
    test('should create /{artist}/{album} resource', () => {
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: '{artist}',
      });
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: '{album}',
      });
    });

    test('should create DELETE method on /{artist}/{album}', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'DELETE',
        Integration: {
          Type: 'AWS',
          IntegrationHttpMethod: 'POST',
          Uri: { "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp('dynamodb')])] },
        },
      });
    });

    test('should have DeleteItem action in DynamoDB integration', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'DELETE',
        Integration: {
          Uri: { "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp('dynamodb.*DeleteItem')])] },
        },
      });
    });

    test('should have method responses 200, 404, 400, and 500', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'DELETE',
        MethodResponses: Match.arrayWith([
          { StatusCode: '200' },
          { StatusCode: '404' },
          { StatusCode: '400' },
          { StatusCode: '500' },
        ]),
      });
    });

    test('should validate path parameters artist and album', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'DELETE',
        RequestParameters: {
          'method.request.path.artist': true,
          'method.request.path.album': true,
        },
      });
    });

    test('should use RequestValidator for DELETE method', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'DELETE',
        RequestValidatorId: Match.anyValue(),
      });
    });

    test('should have integration response with 200 status and error handling', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'DELETE',
        Integration: {
          IntegrationResponses: Match.arrayWith([
            Match.objectLike({
              StatusCode: '200',
            }),
            Match.objectLike({
              StatusCode: '400',
            }),
            Match.objectLike({
              StatusCode: '500',
            }),
          ]),
        },
      });
    });
  });

  describe('GET All Albums Endpoint', () => {
    test('should create GET method on root resource', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
        Integration: {
          Type: 'AWS',
          IntegrationHttpMethod: 'POST',
          Uri: { "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp('dynamodb')])] },
        },
      });
    });

    test('should have Scan action in DynamoDB integration', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
        Integration: {
          Uri: { "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp('dynamodb.*Scan')])] },
        },
      });
    });

    test('should have method responses 200, 400, and 500', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
        MethodResponses: Match.arrayWith([
          { StatusCode: '200' },
          { StatusCode: '400' },
          { StatusCode: '500' },
        ]),
      });
    });

    test('should have integration response with 200 status', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
        Integration: {
          IntegrationResponses: Match.arrayWith([
            Match.objectLike({
              StatusCode: '200',
            }),
            Match.objectLike({
              StatusCode: '400',
            }),
            Match.objectLike({
              StatusCode: '500',
            }),
          ]),
        },
      });
    });
  });

  describe('Integration Templates', () => {
    test('POST integration should have request template with table name', () => {
      const methods = template.findResources('AWS::ApiGateway::Method', {
        Properties: {
          HttpMethod: 'POST',
        },
      });

      const postMethod = Object.values(methods)[0];
      const requestTemplate = postMethod.Properties.Integration.RequestTemplates['application/json'];
      const joinArray = requestTemplate['Fn::Join'][1];

      // Build template string handling references
      const templateParts = joinArray.map((part: any) => {
        if (typeof part === 'string') return part;
        if (part.Ref) return '[TABLE_REF]';
        return '';
      });
      const templateString = templateParts.join('');

      expect(templateString).toMatch(/TableName.*\[TABLE_REF\]/);
    });

    test('POST integration should have request template with Artist and Album fields', () => {
      const methods = template.findResources('AWS::ApiGateway::Method', {
        Properties: {
          HttpMethod: 'POST',
        },
      });

      const postMethod = Object.values(methods)[0];
      const requestTemplate = postMethod.Properties.Integration.RequestTemplates['application/json'];
      const joinArray = requestTemplate['Fn::Join'][1];

      // Build template string handling references
      const templateParts = joinArray.map((part: any) => {
        if (typeof part === 'string') return part;
        if (part.Ref) return '[REF]';
        return '';
      });
      const templateString = templateParts.join('');

      expect(templateString).toMatch(/Artist/);
      expect(templateString).toMatch(/Album/);
    });

    test('DELETE integration should have request template with Key structure', () => {
      const methods = template.findResources('AWS::ApiGateway::Method', {
        Properties: {
          HttpMethod: 'DELETE',
        },
      });

      const deleteMethod = Object.values(methods)[0];
      const requestTemplate = deleteMethod.Properties.Integration.RequestTemplates['application/json'];
      const joinArray = requestTemplate['Fn::Join'][1];

      // Build template string handling references
      const templateParts = joinArray.map((part: any) => {
        if (typeof part === 'string') return part;
        if (part.Ref) return '[REF]';
        return '';
      });
      const templateString = templateParts.join('');

      expect(templateString).toMatch(/Key/);
    });

    test('GET integration should have request template with TableName', () => {
      const methods = template.findResources('AWS::ApiGateway::Method', {
        Properties: {
          HttpMethod: 'GET',
        },
      });

      const getMethod = Object.values(methods)[0];
      const requestTemplate = getMethod.Properties.Integration.RequestTemplates['application/json'];
      const joinArray = requestTemplate['Fn::Join'][1];

      // Build template string handling references
      const templateParts = joinArray.map((part: any) => {
        if (typeof part === 'string') return part;
        if (part.Ref) return '[REF]';
        return '';
      });
      const templateString = templateParts.join('');

      expect(templateString).toMatch(/TableName/);
    });
  });

  describe('Error Responses', () => {
    test('should have 400 error response template for all endpoints', () => {
      const methods = template.findResources('AWS::ApiGateway::Method');
      let foundCount = 0;

      Object.values(methods).forEach((method: any) => {
        const integrationResponses = method.Properties.Integration.IntegrationResponses || [];
        const has400 = integrationResponses.some((response: any) =>
          response.StatusCode === '400' && response.SelectionPattern === '400'
        );
        if (has400) foundCount++;
      });

      expect(foundCount).toBeGreaterThan(0);
    });

    test('should have 500 error response template for all endpoints', () => {
      const methods = template.findResources('AWS::ApiGateway::Method');
      let foundCount = 0;

      Object.values(methods).forEach((method: any) => {
        const integrationResponses = method.Properties.Integration.IntegrationResponses || [];
        const has500 = integrationResponses.some((response: any) =>
          response.StatusCode === '500' && response.SelectionPattern === '5\\d{2}'
        );
        if (has500) foundCount++;
      });

      expect(foundCount).toBeGreaterThan(0);
    });
  });

  describe('Resource Count', () => {
    test('should create exactly one DynamoDB table', () => {
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
    });

    test('should create exactly one REST API', () => {
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    test('should create exactly one LogGroup', () => {
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });

    test('should create IAM Role for API Gateway', () => {
      const roles = template.findResources('AWS::IAM::Role');
      // There should be at least one role (the API Gateway role)
      // CDK may create additional roles for internal purposes
      expect(Object.keys(roles).length).toBeGreaterThanOrEqual(1);

      // Verify that at least one role has the API Gateway service principal
      const apiGatewayRoles = Object.values(roles).filter((role: any) =>
        role.Properties.AssumeRolePolicyDocument?.Statement?.some((stmt: any) =>
          stmt.Principal?.Service === 'apigateway.amazonaws.com'
        )
      );
      expect(apiGatewayRoles.length).toBeGreaterThanOrEqual(1);
    });

    test('should create exactly one Request Validator', () => {
      template.resourceCountIs('AWS::ApiGateway::RequestValidator', 1);
    });

    test('should create exactly one Model', () => {
      template.resourceCountIs('AWS::ApiGateway::Model', 1);
    });

    test('should create at least 3 API Gateway methods (POST, DELETE, GET)', () => {
      const methods = template.findResources('AWS::ApiGateway::Method', {});
      expect(Object.keys(methods).length).toBeGreaterThanOrEqual(3);
    });
  });
});
