'use strict';

var Client = require('3scale').Client;
var request = require('request');
var createClient = require('then-redis').createClient
var Q = require('q');

var client = new Client(process.env.THREESCALE_PROVIDER_ID);
var service_id = process.env.THREESCALE_SERVICE_ID

var authRepUserKey = Q.nbind(client.authrep_with_user_key, client);

var db = createClient({
  host: process.env.ELASTICACHE_ENDPOINT,
  port: process.env.ELASTICACHE_PORT
});

exports.handler = function(event, context, callback) {
  console.log('Received event:', JSON.stringify(event, null, 2));
  var token = JSON.parse(event.Records[0].Sns.Message).token;
  auth(token).then(function(result){
    console.log("AAAA",result);
    var metrics = _.pluck(result.usage_reports,'metric')
    var cached_key = service_id+":"
    _.each(metrics,function(m){
      cached_key += "usage['"+m+"']=1&"
    })
    console.log(cached_key);

    db.set(token,cached_key);
  }).catch(function(err){
    console.log("ERROR:",err);
    db.del(token)
    // context.succeed(generatePolicy('user', 'Deny', event.methodArn));
  }).done(function(){
    console.log("DONE")
    context.done();
  });
};

function auth(token){
  var options = { 'user_key': token, 'usage': { 'hits': 1 }  };
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
