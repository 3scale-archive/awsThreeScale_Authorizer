'use strict';

var Q = require('q');
var request = Q.denodeify(require("request"));
var xml2js = require('xml2js');
var bluebird = require('bluebird');

/* AWS */
var AWS = require('aws-sdk');
AWS.config.region = process.env.AWS_REGION;

/* Connect to Redis Elasticache */
var redis = require("redis");
var db = redis.createClient({
       host: process.env.ELASTICACHE_ENDPOINT,
       port: process.env.ELASTICACHE_PORT
     });
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

/* Configure 3scale */
var Client = require('3scale').Client;
var client = new Client({host:"su1.3scale.net"});
var service_id = process.env.THREESCALE_SERVICE_ID

module.exports.getToken = (event, context, callback) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  //verify format of event Received
  if(event.body != "grant_type=client_credentials"){
    var response = {
        statusCode: 400,
        body: "[400] Wrong or missing grand_type parameter, should be grant_type=client_credentials"
    };
    console.log("response: " + JSON.stringify(response))
    context.succeed(response);
  }else if (!event.headers["Authorization"] || event.headers["Authorization"].indexOf('Basic') == -1){
    var response = {
        statusCode: 400,
        body: "[400] Missing Authorization header"
    };
    context.succeed(response);
  }else{
    //have correct grant_type and authorization header
    //extract app_id in header
    var buff = new Buffer(event.headers["Authorization"].split('Basic ')[1], 'base64').toString().split(':');
    var app_id = buff[0]
    var app_secret = buff[1]
    oauth_authorize(app_id).then(function(result){
      console.log("oAuth Authorize",result)
      return getTokenFromIdp(event.headers["Authorization"])
    }).then(function(result){
      console.log("RESULT",result)
      var response = {
          statusCode: 200,
          body: JSON.stringify(result)
      };

      var message = {
        token: result["access_token"],
        app_id: app_id,
        ttl: result["expires_in"]
      }
      console.log("message",message)
      var sns = new AWS.SNS();
      sns.publish({
          Message: JSON.stringify(message),
          TopicArn: process.env.SNS_OAUTH_SYNC_ARN
      }, function(err, data) {
        console.log(err,data)
          if (err) {
              console.log("SNS error",err.stack);
              return;
          }
          console.log('push sent',data);
          context.succeed(response)
      });
    }) //end then
  }
}

module.exports.storeInCacheAsync = (event, context, callback) => {
  // console.log('Received event:', JSON.stringify(event, null, 2));
  var msg = JSON.parse(event.Records[0].Sns.Message);
  storeTokenInCache(msg.app_id, msg.token, msg.ttl).then(function(result){
    console.log("DONE")
    context.done();
  });
}

module.exports.storeOnThreescaleAsync = (event, context, callback) => {
  // console.log('Received event:', JSON.stringify(event, null, 2));
  var msg = JSON.parse(event.Records[0].Sns.Message)
  storeTokenOnThreescale(msg.app_id, msg.token, msg.ttl).then(function(result){
    console.log("DONE")
    context.done();
  });
}


//Function  to authenticate against 3scale platform
function oauth_authorize(app_id){
  var options = { 'service_token': process.env.THREESCALE_SERVICE_TOKEN, 'app_id': app_id, 'service_id': process.env.THREESCALE_SERVICE_ID};
  var q = Q.defer();
  client.oauth_authorize(options, function (res) {
    // console.log("oauth_authorize res", res)
    if (res.is_success()) {
      q.resolve(res);
      // var trans = [{ service_token: process.env.THREESCALE_SERVICE_TOKEN, app_id: app_id, usage: {"hits": 1} }];
      // client.report(process.env.THREESCALE_SERVICE_ID, trans, function (response) {
      //   console.log("RRR",response);
      // });

    } else {
      q.reject(res);
    }
  });
  return q.promise;
}

function getTokenFromIdp(header_token){
  console.log("getTokenFromIdp called")
  var options ={
    method: 'POST',
    url: process.env.IDP_URL,
    form:{
      "grand_type": 'client_credentials'
    },
    headers:{
      "Authorization": header_token
    }
  };

  var response = request(options);
  return response.then(function (r) {
    var res  = r[0].req.res;
    var body = JSON.parse(r[0].body);
    if (res.statusCode >= 300) {
      throw new Error("Server responded with status code " + r[0].statusCode + " "+JSON.stringify(body.error || body.status));
    } else {
      return body;
    }
  });
}

function storeTokenOnThreescale(app_id, access_token, ttl){
  var url = "https://su1.3scale.net/services/"+process.env.THREESCALE_SERVICE_ID+"/oauth_access_tokens.xml"

  console.log("store on 3scale called")
  var options ={
    method: 'POST',
    url: url,
    qs:{
      provider_key: process.env.THREESCALE_PROVIDER_KEY,
      app_id: app_id,
      token: access_token,
      ttl: ttl
    }
  };

  var response = request(options);
  return response.then(function (r) {
    console.log(r.statusCode)
    var body = r[0].body;
    console.log("jjo",r[0].body,"aa")
    var parser = new xml2js.Parser();
    parser.parseString(r[0].body,function (err, result) {
        console.dir(result);
        console.log('Done');
    });
    if (res.statusCode >= 300) {
      throw new Error("Server responded with status code " + r[0].statusCode + " "+JSON.stringify(body.error || body.status));
    } else {
      return body;
    }
  });
}

function storeTokenInCache(app_id, access_token, ttl) {
  console.log("Store in cache called")
  return db.setAsync(access_token,app_id).then(function(result){
    console.log("RESULT", result)
    return db.expireAsync(access_token,ttl)
  })
}
