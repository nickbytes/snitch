var os = require('os');
var util = require('util');
var _ = require('underscore');
var s = require("underscore.string");

var Botkit = require('botkit');

var express = require('express');
var app = express();
var http = require('http').Server(app);
var request = require('request');
var io = require('socket.io')(http);

var redis = require('redis'),
    redis_client = redis.createClient(process.env.REDIS_URL);

// logs

function _log(){
    console.log.apply(console, arguments);
}

function _error(){
    console.error.apply(console, arguments);
}

function _dump(){
    _.each(arguments, function(arg){
        _log(util.inspect(arg));
    });
}

// web server

if (! process.env.PORT) {
    process.env.PORT = 3000;
}

app.use(express.static('public'));

http.listen(process.env.PORT, function(){
    _log('listening on port ' + process.env.PORT);
});

app.get("/file/:file_id/:variant.:ext?", function(req, res){
    get_file(req.params.file_id, function(err, file){
        file = JSON.parse(file);

        if (err || ! file) {
            return request('https://slack-imgs.com/?url=null&width=360&height=250').pipe(res);
        }

        // TODO: check if file mode is hosted or external

        var url = file[req.params.variant];

        if (! url) {
            return request('https://slack-imgs.com/?url=null&width=360&height=250').pipe(res);
        }

        request({
            url: url,
            headers: {
                'Authorization': 'Bearer ' + bot.config.token
            }
        }).pipe(res);
    });
});

var cache = {
    users: {},
    bots: {},
    channels: {},
};

// slackbot

if (! process.env.SLACK_BOT_TOKEN) {
    _error('Error: Specify SLACK_BOT_TOKEN in environment');
    process.exit(1);
}

var controller = Botkit.slackbot({
    debug: true,
});

var bot = controller.spawn({
    simple_latest: true,
    no_unreads: true,
    token: process.env.SLACK_BOT_TOKEN
}).startRTM(function(err, bot, res){
    if (err || ! res.ok) {
        _error("Error with startRTM, crashing...");
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
    // _log(util.inspect(message));
});


controller.on('channel_leave', function(bot, message){
    cache_list('channels');

    // TODO: update clients
    // _log(util.inspect(message));
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

    io.emit('message', sanitized_message(message));

    save_message(message.channel, message.ts, message);

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'white_small_square',
    }, emoji_reaction_error_callback);
});


controller.on('bot_message', function(bot, message){
    bot.botkit.log("[BOT MESSAGE] " + message.text);

    io.emit('message', sanitized_message(message));

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

    io.emit('message', sanitized_message(message));

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

    if (message.file) {
        update_file(message.file);
    }

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


controller.on('file_share', function(bot, message){
    _dump("[file_share]", message);

    io.emit('message', sanitized_message(message));

    save_message(message.channel, message.ts, message);

    save_file(message.file);

    bot.api.reactions.add({
        file: message.file.id,
        name: 'white_small_square',
    }, emoji_reaction_error_callback);
});


controller.on('file_change', function(bot, message){
    _dump("[file_change]", message);

    update_file(message.file);

    bot.api.reactions.add({
        file: message.file.id,
        name: 'small_orange_diamond',
    }, emoji_reaction_error_callback);
});


controller.on('file_deleted', function(bot, message){
    _dump("[file_deleted]", message);

    delete_file(message.file_id);
});


io.on('connection', function (socket) {
    socket.on('request_backfill', function(data){
        _.each(_.keys(cache.channels), function(channel_id){
            get_recent_messages(channel_id, 300, function(err, response){
                if (err) throw err;

                _.each(response.reverse(), function(message){
                    var message = JSON.parse(message);

                    message = sanitized_message(message);

                    message.is_backfill = true;

                    socket.emit('message', message);
                });
            });
        });

        socket.emit('backfill_complete', true);
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

function delete_message(channel_id, ts) {
    redis_client.zremrangebyscore("channels." + channel_id, ts, ts, redis.print);
}

function update_message(channel_id, ts, message) {
    delete_message(channel_id, ts);
    save_message(channel_id, ts, message);
}

function get_recent_messages(channel_id, count, callback) {
    redis_client.zrevrangebyscore(["channels." + channel_id, "+inf", "-inf", "LIMIT", 0, count], callback)
}

function save_file(file) {
    redis_client.set("files." + file.id, JSON.stringify(file), redis.print);
}

function delete_file(file_id) {
    redis_client.del("files." + file_id, redis.print);
}

function update_file(file) {
    delete_file(file.id);
    save_file(file);
}

function get_file(file_id, callback) {
    redis_client.get("files." + file_id, callback)
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

        // _log(util.inspect(cache[options.api_method]));
    });
}

function sanitized_message(message){
    var example = {
        user: { }, // sanitized_user(message.channel)
        channel: { }, // sanitized_channel(message.user)

        ts: 1234567890.12345,

        attachments: {
            file: {
                byline: "",
                name: "",
                low_res: "",
                high_res: "",
                initial_comment: ""
            },
            inline: [
                {
                    color: "red",

                    pretext: "",

                    author: {
                        name: "",
                        subname: "",
                        icon: ""
                    },

                    inline_title: "",
                    inline_title_link: "",

                    inline_text: "",

                    fields: [
                        {
                            field_title: "",
                            field_value: "",
                            short: true
                        }
                    ],

                    image_url: "",
                    thumb_url: ""
                }
            ]
        }
    };


    var alt_payload = undefined;
    if (message.bot_id) alt_payload = message;

    var response = {
        ts: message.ts,
        user: sanitized_user(message.user || message.bot_id, alt_payload),
        channel: sanitized_channel(message.channel),
        text: reformat_message_text(message.text)
    };

    if (message.file) {
        response.attachments = response.attachments || {};
        response.attachments.file = sanitized_message_attachment_file(message.file);

        delete response.text;
    }

    if (_.size(message.attachments) > 0) {
        response.attachments = response.attachments || {};
        response.attachments.inline = response.attachments.inline || [];

        _.each(message.attachments, function(attachment){
            response.attachments.inline.push(sanitized_message_attachment_inline(attachment));
        });
    }

    return response;
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
        return { name: 'channel', members: {} };
    }

    channel = _.pick(channel, 'name', 'topic', 'members');

    if (channel.topic) channel.topic = channel.topic.value;

    var members = {};
    _.each(channel.members, function(id){
        var user = sanitized_user(id);
        members[user.name] = user;
    });
    channel.members = members;

    return channel;
}

function sanitized_message_attachment_file(file){
    if (! file) {
        return false;
    }

    var response = {
        name: file.title,
        full_res: "/file/" + file.id + "/url_private." + file.filetype
    };

    if (file.mode == "hosted" && s.startsWith(file.mimetype, "image/")) {
        response.low_res = "/file/" + file.id + "/thumb_360." + file.filetype;
    } else {
        response.download_url = "/file/" + file.id + "/url_private_download." + file.filetype;
    }

    var byline = ["uploaded"];

    if (file.initial_comment) {
        byline.push("and commented on");
    }

    if (file.mode == "hosted") {
        if (s.startsWith(file.mimetype, "image/")) {
            byline.push("an image");
        } else {
            byline.push("a file");
        }
    } else {
        // TODO: proper indefinite article
        byline.push("a " + file.pretty_type + " file");
    }

    response.byline = byline.join(" ");

    if (file.initial_comment) {
        response.initial_comment = reformat_message_text(file.initial_comment.comment);
    }

    return response;
}

function sanitized_message_attachment_inline(attachment){
    var response = _.pick(attachment, "color", "pretext", "fields", "image_url", "thumb_url");

    // TODO: prefer video_html (over thumb_url)

    response.inline_title = attachment.title;
    response.inline_title_link = attachment.title_link;

    if (attachment.author_name || attachment.author_subname || attachment.author_icon) {
        response.author = {
            name: attachment.author_name,
            subname: attachment.author_subname,
            icon: attachment.author_icon
        };
    }

    if (attachment.pretext) {
        response.pretext = reformat_message_text(attachment.pretext);
    }

    if (attachment.text) {
        response.inline_text = reformat_message_text(attachment.text);
    }

    if (response.color && ! s.startsWith(response.color, "#")) {
        response.color = "#" + response.color;
    }

    return response;
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
                    if (label) {
                        return "<a href='" + link + "'>" + label + "</a>";
                    } else {
                        return "<a href='" + link + "'>" + link.replace(/^mailto:/, '') + "</a>";
                    }
            }
        };
    })(this));

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

