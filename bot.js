// init

if (! process.env.SLACK_BOT_TOKEN) {
    console.error('Error: Specify SLACK_BOT_TOKEN in environment');
    process.exit(1);
}

if (! process.env.PORT) {
    process.env.PORT = 3000;
}

var os = require('os');
var util = require('util');
var _ = require('underscore');

var Botkit = require('botkit');

var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var redis = require('redis'),
    redis_client = redis.createClient(process.env.REDIS_URL);

// web server

app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});

http.listen(process.env.PORT, function(){
    console.log('listening on port ' + process.env.PORT);
});

var cache = {
    users: {},
    bots: {},
    channels: {},
};

// slackbot

var controller = Botkit.slackbot({
    debug: true,
});

var bot = controller.spawn({
    simple_latest: true,
    no_unreads: true,
    token: process.env.SLACK_BOT_TOKEN
}).startRTM(function(err, bot, res){
    if (err || ! res.ok) {
        console.log("Error with startRTM, crashing...");
        process.exit(1);
    }

    cache.users = {};
    _.each(res.users, function(item){
        cache.users[item.id] = item;
    });

    _.each(res.bots, function(item){
        cache.bots[item.id] = item;
    });

    cache.channels = {};
    _.each(res.channels, function(item){
        cache.channels[item.id] = item;
    });
});

// integrations

controller.on('channel_created', function(bot, message){
    cache_list('channels');

    // TODO: update clients
});


controller.on('channel_deleted', function(bot, message){
    cache_list('channels');

    // TODO: update clients
});


controller.on('channel_rename', function(bot, message){
    cache_list('channels');

    // TODO: update clients
});


controller.on('channel_archive', function(bot, message){
    cache_list('channels');

    // TODO: update clients
});


controller.on('channel_unarchive', function(bot, message){
    cache_list('channels');

    // TODO: update clients
});


controller.on('user_channel_join', function(bot, message){
    cache_list('channels');

    // TODO: update clients
    // console.log(util.inspect(message));
});


controller.on('channel_leave', function(bot, message){
    cache_list('channels');

    // TODO: update clients
    // console.log(util.inspect(message));
});


controller.on('team_join', function(bot, message){
    bot.botkit.log("[TEAM JOIN] " + message.user.name);

    cache.users[message.user.id] = message.user;

    // TODO: update clients
});


controller.on('user_change', function(bot, message){
    bot.botkit.log("[USER CHANGE] " + message.user.name);

    cache.users[message.user.id] = message.user;

    // TODO: update clients
});


controller.on('bot_added', function(bot, message){
    bot.botkit.log("[BOT ADDED] " + message.bot.name);

    cache.bots[message.bot.id] = message.bot;

    // TODO: update clients
});


controller.on('bot_changed', function(bot, message){
    bot.botkit.log("[BOT UPDATED] " + message.bot.name);

    cache.bots[message.bot.id] = message.bot;

    // TODO: update clients
});


controller.on('ambient', function(bot, message){
    bot.botkit.log("[AMBIENT] " + message.text);

    var timestamp = message.ts.split(".")[0];

    io.emit('message', {
        timestamp: timestamp,
        channel: sanitized_channel(message.channel),
        user: sanitized_user(message.user),
        text: reformat_message_text(message.text)
    });

    save_message(message.channel, message.ts, message);

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'white_small_square',
    }, emoji_reaction_error_callback);
});


controller.on('bot_message', function(bot, message){
    bot.botkit.log("[BOT MESSAGE] " + message.text);

    var timestamp = message.ts.split(".")[0];

    io.emit('message', {
        timestamp: timestamp,
        channel: sanitized_channel(message.channel),
        user: sanitized_user(message.bot_id, message),
        text: reformat_message_text(message.text)
    });

    save_message(message.channel, message.ts, message);

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'white_small_square',
    }, emoji_reaction_error_callback);
});


controller.on('me_message', function(bot, message){
    message.text = "/me " + message.text;

    bot.botkit.log("[ME MESSAGE] " + message.text);

    var timestamp = message.ts.split(".")[0];

    io.emit('message', {
        timestamp: timestamp,
        channel: sanitized_channel(message.channel),
        user: sanitized_user(message.user),
        text: reformat_message_text(message.text)
    });

    save_message(message.channel, message.ts, message);

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'white_small_square',
    }, emoji_reaction_error_callback);
});


controller.on('message_changed', function(bot, message){
    bot.botkit.log("[MESSAGE CHANGED] " + util.inspect(message));

    // copy channel to actual message, so it won't get lost on edit
    message.message.channel = message.channel;

    // TODO: update clients

    update_message(message.channel, message.message.ts, message.message);

    bot.api.reactions.add({
        timestamp: message.message.ts,
        channel: message.channel,
        name: 'small_orange_diamond',
    }, emoji_reaction_error_callback);
});


controller.on('message_deleted', function(bot, message){
    bot.botkit.log("[MESSAGE DELETED] " + util.inspect(message));

    // TODO: update clients

    delete_message(message.channel, message.deleted_ts);

    bot.startPrivateConversation(message.previous_message, function(err, dm){
        dm.say("I removed the message you deleted from the public record.");
    });
});


controller.on('user_typing', function(bot, message){
    bot.botkit.log('[TYPING] ' + message.user);

    io.emit('typing', {
        channel: sanitized_channel(message.channel),
        user: sanitized_user(message.user)
    });
});


io.on('connection', function (socket) {
    socket.on('request_backfill', function(data){
        get_recent_messages("C0J4J68N4", 100, function(err, response){
            if (err) throw err;

            _.each(response.reverse(), function(message){
                var message = JSON.parse(message);

                var timestamp = message.ts.split(".")[0];

                var alt_payload = undefined;

                if (message.bot_id) {
                    alt_payload = message;
                }

                socket.emit('message', {
                    is_backfill: true,
                    timestamp: timestamp,
                    channel: sanitized_channel(message.channel),
                    user: sanitized_user(message.user || message.bot_id, alt_payload),
                    text: reformat_message_text(message.text)
                });
            });
        });
    });
});

controller.on('tick', function(bot, message){});


controller.hears(['shutdown'],'direct_message,direct_mention,mention',function(bot, message){

    bot.startConversation(message, function(err, convo){
        convo.ask('Are you sure you want me to shutdown?',[
            {
                pattern: bot.utterances.yes,
                callback: function(response, convo) {
                    convo.say('Bye!');
                    convo.next();
                    setTimeout(function() {
                        process.exit();
                    },3000);
                }
            },
        {
            pattern: bot.utterances.no,
            default: true,
            callback: function(response, convo) {
                convo.say('*Phew!*');
                convo.next();
            }
        }
        ]);
    });
});


controller.hears(['uptime'],'direct_message,direct_mention,mention',function(bot, message) {

    var hostname = os.hostname();
    var uptime = process.uptime();
    var unit = 'second';
    
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'minute';
    }

    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'hour';
    }

    if (uptime != 1) {
        unit = unit + 's';
    }

    uptime = uptime + ' ' + unit;

    bot.reply(message,':robot_face: I am a bot named <@' + bot.identity.name + '>. I have been running for ' + uptime + ' on ' + hostname + '.');
});

// helpers

function save_message(channel_id, ts, message) {
    redis_client.zadd("channels." + channel_id, ts, JSON.stringify(message), redis.print);

    // redis_client.zremrangebyscore("channels." + channel_id, ts, ts - (60 * 5)); // 86400
}

function update_message(channel_id, ts, message) {
    delete_message(channel_id, ts);
    redis_client.zadd("channels." + channel_id, ts, JSON.stringify(message), redis.print);
}

function delete_message(channel_id, ts) {
    redis_client.zremrangebyscore("channels." + channel_id, ts, ts, redis.print);
}

function get_recent_messages(channel_id, count, callback) {
    redis_client.zrevrangebyscore(["channels." + channel_id, "+inf", "-inf", "LIMIT", 0, count], callback)
}

function cache_list(variant) {
    var options = {
        api_method: variant,
        response_wrapper: variant
    };

    // allow overriding abnormal param names

    if (variant == 'users') {
        options.response_wrapper = 'members';
    }

    bot.api[options.api_method].list({}, function(err, res){
        if (err || ! res.ok) bot.botkit.log("Error calling bot.api." + options.api_method + ".list");

        cache[options.api_method] = {};

        _.each(res[options.response_wrapper], function(item){
            cache[options.api_method][item.id] = item;
        });

        // console.log(util.inspect(cache[options.api_method]));
    });
}

function sanitized_user(user, alt_payload){
    var user = cache.users[user] || cache.bots[user];

    if (! user) {
        bot.botkit.log("Could not find cached user: " + user);
        return { name: 'Anonymous', profile: {} };
    }

    user.is_bot = !! cache.bots[user.id];

    user = _.pick(user, 'name', 'color', 'profile', 'icons', 'is_bot');

    user.profile = _.pick(user.profile, 'first_name', 'last_name', 'real_name', 'image_72');

    if (user.icons) {
        user.profile.image = user.icons.image_72;
    } else {
        user.profile.image = user.profile.image_72;
    }

    // allow overriding cache with alt payload (e.g. from bot_message)
    if (alt_payload && alt_payload.username) {
        user.name = alt_payload.username;
    }

    if (alt_payload && _.size(_.omit(alt_payload.icons, "emoji")) > 0) {
        user.profile.image = _.last(_.values(_.omit(alt_payload.icons, "emoji")));
    }

    return user;
}

function sanitized_channel(channel){
    var channel = cache.channels[channel];
    
    if (! channel) {
        bot.botkit.log("Could not find cached channel: " + channel);
        return { name: '#channel', members: {} };
    }

    channel = _.pick(channel, 'name', 'topic', 'members');

    channel.topic = channel.topic.value;

    var members = {};
    _.each(channel.members, function(id){
        var user = sanitized_user(id);
        members[user.name] = user;
    });
    channel.members = members;

    return channel;
}


function reformat_message_text(text) {
    // https://api.slack.com/docs/formatting
    text = text.replace(/<([@#!])?([^>|]+)(?:\|([^>]+))?>/g, (function(_this) {
        return function(m, type, link, label) {
            var channel, user;

            switch (type) {
                case '@':
                    if (label) return label;

                    user = cache.users[link];

                    if (user) return "@" + user.name;

                    break;
                case '#':
                    if (label) return label;
                    
                    channel = cache.channels[link];
                    
                    if (channel) return "\#" + channel.name;
                    
                    break;
                case '!':
                    if (['channel','group','everyone','here'].indexOf(link) >= 0) {
                        return "@" + link;
                    }

                    break;
                default:
                    if (label && -1 !== link.indexOf(label)) {
                        return "<a href='" + link + "'>" + label + "</a>";
                    } else {
                        return "<a href='" + link + "'>" + link.replace(/^mailto:/, '') + "</a>";
                    }
            }
        };
    })(this));

    // text = text.replace(/&lt;/g, '<');
    // text = text.replace(/&gt;/g, '>');
    // text = text.replace(/&amp;/g, '&');

    // nl2br
    text = text.replace(/\n/g, "<br/>");

    // me_message
    if (text.indexOf("/me") === 0) {
        text = "<span class='me_message'>" + text + "</span>";
    }

    return text;
}

function emoji_reaction_error_callback(err, res) {
    if (err) {
        bot.botkit.log('Failed to add emoji reaction :( ', err);
    }
}

