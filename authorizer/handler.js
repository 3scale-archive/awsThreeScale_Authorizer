'use strict';

console.log('Loading function');

var Client = require('3scale').Client;
var request = require('request');
var createClient = require('then-redis').createClient
var Q = require('q');
var _ = require('underscore')

var AWS = require('aws-sdk');
AWS.config.region = process.env.SERVERLESS_REGION;

var client = new Client(process.env.THREESCALE_PROVIDER_KEY);
// var service_id = process.env.THREESCALE_SERVICE_ID

var authRepUserKey = Q.nbind(client.authrep_with_user_key, client);

var db = createClient({
  host: process.env.ELASTICACHE_ENDPOINT,
  port: process.env.ELASTICACHE_PORT
});

exports.handler = function(event, context, callback){
    console.log('Received event:', JSON.stringify(event, null, 2));
    var token = event.authorizationToken;
    var service = extractARN(event.methodArn)
    var a =[
      {
        "aws_gateway_id": "kcoty4ux13",
        "stage": "dev",
        "threescale_service_id": "2555417731327"
      },
      {
        "aws_gateway_id": "kcoty4ux13",
        "stage": "prod",
        "threescale_service_id": "2555417732619"
      }
    ]

    service["threescale_service_id"] = a.find(function(el){
      return el.aws_gateway_id == service.gateway_id && el.stage == service.stage
    }).threescale_service_id

    console.log(service);
    var hash = service.threescale_service_id +":"+token
    
    db.get(hash).then(function(value){
      if (value != null) {
        console.log('Token exists in cache, value is',value);

        //Send message on threescaleAsync SNS topic
        //message contains token
        var sns = new AWS.SNS();
        var message = {token: token} //TODO change to HASH
        sns.publish({
            Message: JSON.stringify(message),
            TopicArn: process.env.SNS_TOPIC_ARN
        }, function(err, data) {
            if (err) {
                console.log(err.stack);
                return;
            }
            console.log('push sent',data);
            context.succeed(generatePolicy('user', 'Allow', event.methodArn));
        });
       } else {
          console.log('Token does not exist in cache');

          auth(token,service).then(function(result){
            console.log("3scale response",result);

            var metrics = _.pluck(result.usage_reports,'metric')
            var cached_key = service.threescale_service_id+":"
            _.each(metrics,function(m){
              cached_key += "usage['"+m+"']=1&"
            })

            //sotre key and its usage in cache
            db.set(hash,cached_key);

            context.succeed(generatePolicy('user', 'Allow', event.methodArn));
          }).catch(function(err){
            console.log("ERROR:",err);
            context.succeed(generatePolicy('user', 'Deny', event.methodArn));
          }).done(function(){
            context.done();
          })
       }
    })
}

//Function  to authenticate against 3scale platform
function auth(token,service){
  var usage = { 'hits': 1 }
  usage[service.method+'_'+service.path] = 1
  console.log("USAGE",usage)

  var options = { 'user_key': token, 'usage': usage, 'service_id': service.threescale_service_id };
  var q = Q.defer();
  client.authrep_with_user_key(options, function (res) {
    if (res.is_success()) {
      q.resolve(res);
    } else {
      q.reject(res);
    }
  });
  return q.promise;
}

//Create a AWS Policy document that will be evaluate by the API Gateway
var generatePolicy = function(principalId, effect, resource) {
    var authResponse = {};
    authResponse.principalId = principalId;
    if (effect && resource) {
        var policyDocument = {};
        policyDocument.Version = '2012-10-17'; // default version
        policyDocument.Statement = [];
        var statementOne = {};
        statementOne.Action = 'execute-api:Invoke'; // default action
        statementOne.Effect = effect;
        statementOne.Resource = resource;
        policyDocument.Statement[0] = statementOne;
        authResponse.policyDocument = policyDocument;
    }
    return authResponse;
}

var extractARN = function(ARN){
  //arn:aws:execute-api:us-east-1:125661084241:ac66xzfuhj/dev/GET/greetings
  var slash = ARN.split('/')
  var splitedARN = slash[0].split(':')
  var gatewayId = splitedARN[splitedARN.length-1]
  var stage = slash[1]
  var method = slash[2]
  var resourcePath =  ARN.slice(ARN.indexOf('/'+slash[3]),ARN.length)
  return {
    "gateway_id": gatewayId,
    "stage": stage,
    "method": method,
    "path":resourcePath
  }
}

Array.prototype.find = function(predicate) {
  if (this === null) {
    throw new TypeError('Array.prototype.find called on null or undefined');
  }
  if (typeof predicate !== 'function') {
    throw new TypeError('predicate must be a function');
  }
  var list = Object(this);
  var length = list.length >>> 0;
  var thisArg = arguments[1];
  var value;

  for (var i = 0; i < length; i++) {
    value = list[i];
    if (predicate.call(thisArg, value, i, list)) {
      return value;
    }
  }
  return undefined;
  };
