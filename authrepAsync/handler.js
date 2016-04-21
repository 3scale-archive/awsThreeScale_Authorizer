'use strict';

var Client = require('3scale').Client;
var request = require('request');
var createClient = require('then-redis').createClient
var Q = require('q');

var client = new Client(process.env.THREESCALE_PROVIDER_KEY);
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
    console.log("3scale response",result);
    var metrics = _.pluck(result.usage_reports,'metric')
    var cached_key = service_id+":"
    _.each(metrics,function(m){
      cached_key += "usage['"+m+"']=1&"
    })

    //store in cache
    db.set(token,cached_key);
  }).catch(function(err){
    console.log("ERROR:",err);
    
    //delete ken from cache
    db.del(token)
  }).done(function(){
    console.log("DONE")
    context.done();
  });
};

//Function  to authenticate against 3scale platform
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
