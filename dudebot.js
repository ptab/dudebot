/*
TODO
- get src instead of display URL
- multiple tools
- multiple environments
- amsterdam vs frankfurt
- different replies instead of hardcoded one
- decent code
*/

const config = require('./config.json');
const https = require('https');
const tabletojson = require('tabletojson');

var controller = require('botkit').slackbot({ debug: false });
var slackbot = controller.spawn({ token: getToken('slack') }).startRTM((err, bot, payload) => {
  if (err) throw new Error('Unable to connect to Slack: ' + err)
});

var witbot = require('../witbot')(getToken('wit'))

var data = {};

controller
  .on(['direct_message', 'direct_mention', 'mention'], (bot, message) => {
    witbot
      .process(message.text)
      .hears('help', config.confidence.reply, (outcome) => {
        log(outcome);
        replyToUser(message, 'hi! I think you want to ask me something. Try _"do you know the URL for Kibana in production?"_');
      })
      .otherwise((outcome) => {
        log(outcome);
      });
  })
  .on(['direct_message', 'direct_mention', 'mention', 'ambient'], (bot, message) => {
    var confidenceToAsk = initialConfidence(message.event);
    var confidenceToReply = config.confidence.reply;

    var askForEnvironment = function (convo) {
      convo.ask(toUser(message, 'on which environment?'), (response, convo) => {
        witbot
          .process(response.text, { state: 'question_asked' })
          .hears('reply_with_environment', config.confidence.reply, (outcome) => {
            if (parse(message, outcome, 'environment')) convo.next()
            else invalidReply(convo, message, 'environment');
          })
          .otherwise((outcome) => {
            log(outcome);
            invalidReply(convo, message, 'environment');
          });
      });
    };

    witbot
      .process(message.text)
      .hears('ask_with_both', confidenceToAsk, (outcome) => {
        if (parse(message, outcome, 'tool') && parse(message, outcome, 'environment')) {
          sendUrl(message);
        } else {
          replyWithNoClue(message);
        }
      })
      .hears('ask_with_tool', confidenceToAsk, (outcome) => {
        if (parse(message, outcome, 'tool')) {
          slackbot.startConversation(message, (_, convo) => {
            askForEnvironment(convo);
            convo.on('end', (convo) => {
              if (convo.status == 'completed') sendUrl(message);
              clear(message);
            });
          });
        } else {
          invalidReply(convo, message, 'tool');
        }
      })
      .hears('ask_with_none', confidenceToAsk, (outcome) => {
        slackbot.startConversation(message, (_, convo) => {
          convo.ask(toUser(message, 'which tool?'), (response, convo) => {
            witbot
              .process(response.text, { state: 'question_asked' })
              .hears('reply_with_both', confidenceToReply, (outcome) => {
                if (!parse(message, outcome, 'tool')) invalidReply(convo, message, 'tool');
                else if (!parse(message, outcome, 'environment')) invalidReply(convo, message, 'environment');
                else convo.next();
              })
              .hears('reply_with_tool', confidenceToReply, (outcome) => {
                if (parse(message, outcome, 'tool')) {
                  askForEnvironment(convo);
                  convo.next();
                } else {
                  invalidReply(convo, message, 'tool');
                }
              })
              .otherwise((outcome) => {
                log(outcome);
                invalidReply(convo, message, 'tool');
              });
          });

          convo.on('end', (convo) => {
            if (convo.status == 'completed') sendUrl(message);
            clear(message);
          });
        });
      });
  });

function parse(message, outcome, key) {
  if (empty(outcome.entities)) return false;
  if (empty(outcome.entities[key])) return false;
  if (empty(outcome.entities[key][0].value)) return false;
  store(message, key, outcome.entities[key][0].value);
  return true;
}

function sendUrl(message) {
  var tool = get(message, 'tool');
  var environment = get(message, 'environment');

  var options = {
    method: 'GET',
    host: config.confluence.api.host,
    port: config.confluence.api.port,
    path: '/rest/api/content/' + config.confluence.content_id + '?expand=body.view',
    auth: config.confluence.api.username + ':' + config.confluence.api.password,
    rejectUnauthorized: false // ignore self-signed certificates ..
  };

  https
    .get(options, (res) => {
      res.setEncoding('utf8');
      var data = '';

      res
        .on('data', (chunk) => {
          data += chunk;
        })
        .on('end', () => {
          var table = tabletojson.convert(JSON.parse(data).body.view.value)[0];

          var url;
          for (var i in table) {
            var entry = table[i];
            if (entry.Tool.toUpperCase() === tool.toUpperCase()) {
              url = entry[config.headers[environment]];
              break;
            }
          }

          if (url) replyToUser(message, 'there you go: ' + url);
          else replyWithNoClue(message);
        });
    })
    .on('error', (e) => {
      console.log(e);
      replyToUser(message, 'Confluence is mad at me :(');
      reply(message, 'See if it talks to you: ' + config.confluence.url);
    });
}

function invalidReply(convo, message, question) {
  if (inc(message, 'wrong_' + question) >= config.wrong_replies[question]) {
    replyWithNoClue(message);
    convo.stop();
  } else {
    reply(message, 'uh? I don\'t know that one');
    convo.repeat();
    convo.next();
  }
}

function reply(message, text) {
  slackbot.reply(message, text);
}

function replyToUser(message, text) {
  slackbot.reply(message, toUser(message, text));
}

function replyWithNoClue(message) {
  slackbot.reply(message, toUser(message, '¯\\_(ツ)_/¯'));
  slackbot.reply(message, 'Try to find it here: ' + config.confluence.url);
}

// helper functions

function toUser(message, text) {
  return '<@' + message.user + '>: ' + text;
}

function empty(obj) {
  return !obj || obj.length === 0;
}

function inc(message, key) {
  if (!data[message.user]) data[message.user] = {};
  var c = get(message, key);
  if (!c) c = 0;
  store(message, key, ++c);
  return c;
}

function store(message, key, value) {
  if (!data[message.user]) data[message.user] = {};
  data[message.user][key] = value;
}

function get(message, key) {
  if (data[message.user]) return data[message.user][key];
  else return undefined;
}

function clear(message) {
  if (data[message.user]) delete data[message.user];
}

function initialConfidence(event) {
  if (event === 'ambient') return config.confidence.start;
  else return config.confidence.reply;
}

function getToken(name) {
  var token = config.tokens[name];
  if (token) return token;
  else throw new Error('Token for ' + name + ' is not defined');
}

function log(outcome) {
  console.log('Heard', outcome.intent, 'with', outcome.confidence, 'confidence for:', outcome._text);
}
