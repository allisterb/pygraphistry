'use strict';

var Q           = require('q');
var sprintf     = require('sprintf-js').sprintf;
var bodyParser  = require('body-parser');

var config      = require('config')();
var Log         = require('common/logger.js');
var slack       = require('common/slack.js');
var apiKey      = require('common/api.js');
var etl1        = require('./src/etl1.js');
var logger      = Log.createLogger('etlworker:index');




// String * String -> ()
function slackNotify(name, nnodes, nedges, params) {
    function makeUrl(server) {
        return '<http://proxy-' + server + '.graphistry.com' +
               '/graph/graph.html?info=true&dataset=' + name +
               '|' + server + '>';
    }
    function isInternal(key) {
        var suffix = 'graphistry.com';
        return key.slice(-suffix.length) === suffix
    }

    var key = '';
    if (params.key) {
        try {
            key += apiKey.decrypt(params.key);
        } catch (err) {
            logger.error('Could not decrypt key', err);
            key += ' COULD NOT DECRYPT';
        }
    } else {
        key = 'n/a';
    }

    var links = sprintf('View on %s or %s', makeUrl('labs'), makeUrl('staging'));
    var title = sprintf('*New dataset:* `%s`', name);
    var tag = sprintf('`%s`', params.usertag.split('-')[0]);

    var msg = {
        channel: '#datasets',
        username: key,
        text: '',
        attachments: JSON.stringify([{
            fallback: 'New dataset: ' + name,
            text: title + '\n' + links,
            color: isInternal(key) ? 'good' : 'bad',
            fields: [
                { title: 'Nodes', value: nnodes, short: true },
                { title: 'Edges', value: nedges, short: true },
                { title: 'API', value: params.apiVersion, short: true },
                { title: 'Machine Tag', value: tag, short: true },
                { title: 'Agent', value: params.agent, short: true },
                { title: 'Version', value: params.agentVersion, short: true },
            ],
            mrkdwn_in: ['text', 'pretext', 'fields']
        }])
    };

    return Q.denodeify(slack.post)(msg)
        .fail(function (err) {
            logger.error('Error posting on slack', err);
        });
}


function parseQueryParams(req) {
    var res = [];

    res.usertag = req.query.usertag || 'unknown';
    res.agent = req.query.agent || 'unknown';
    res.agentVersion = req.query.agentversion || '0.0.0';
    res.apiVersion = parseInt(req.query.apiversion) || 0;
    res.key = req.query.key;

    return res;
}


function makeFailHandler(res, tearDown) {
    return function (err) {
        logger.error(err, 'ETL post fail');
        res.send({
            success: false,
            msg: err.message
        });
        logger.debug('Failed worker, tearing down');
        tearDown(1);
    };
}


function dispatcher(tearDown, req, res) {
    var params = parseQueryParams(req);

    var handlers = {
        '0': etl1.process,
        '1': etl1.process,
        '2': function() {}
    }

    var apiVersion = params.apiVersion || 0;
    var handler = handlers[apiVersion];
    if (handler !== undefined) {
        handler(req, res, params)
            .then(function (info) {
                return slackNotify(info.name, info.nnodes, info.nedges, params);
            }).then(function() {
                tearDown(0);
            }).fail(makeFailHandler(res, tearDown));
    } else {
        res.send({ success: false, msg: 'Unsupported API version:' + apiVersion });
        tearDown(1);
    }
}


function tearDown(socket, exitCode) {
    logger.debug('Worker finished, exiting');
    if (config.ENVIRONMENT === 'production' || config.ENVIRONMENT === 'staging') {
        process.exit(exitCode);
    } else {
        logger.warn('not actually exiting, only disconnect socket');
        socket.disconnect();
    }
}


function init(app, socket) {
    logger.debug('Client connected', socket.id);

    app.post('/etl', bodyParser.json({type: '*', limit: '128mb'}),
             dispatcher.bind('', tearDown.bind('', socket)));
}


module.exports = {
    staticFilePath: function() { return __dirname; },
    init: init
}
