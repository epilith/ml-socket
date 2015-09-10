var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var marklogic = require('marklogic');
var request = require('request');
var md5 = require('md5');

var ML_HOST = 'localhost';
var ML_PORT = '8000';
var ML_USER = 'admin';
var ML_PASSWORD = 'admin';
var ML_AUTHTYPE = 'DIGEST';

var db = marklogic.createDatabaseClient({
    host: ML_HOST,
    port: ML_PORT,
    user: ML_USER,
    password: ML_PASSWORD,
    authType: ML_AUTHTYPE
});

var alertAuth = {
    'user': ML_USER,
    'pass': ML_PASSWORD,
    'sendImmediately': false
};

if (typeof String.prototype.endsWith !== 'function') {
    String.prototype.endsWith = function (suffix) {
        return this.indexOf(suffix, this.length - suffix.length) !== -1;
    };
}

var uriRoomMap = {}; // map from directory uri to room id
var roomOccupancy = {}; // map from room id to count of listeners

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

var matchUrl = "http://" + ML_HOST + ":" + ML_PORT + "/LATEST/alert/match";
var rulesUrl = "http://" + ML_HOST + ":" + ML_PORT + "/LATEST/alert/rules/";

var alertOn = function (uri, content, event) {
    return new Promise(function (success, fail) {
            console.log("alerting on document " + uri);
            request({
                auth: alertAuth,
                method: 'GET',
                url: matchUrl,
                qs: {uri: uri},
                headers: {
                    Accept: 'application/json'
                },
                sendImmediately: false
            }, function (error, response, body) {
                if (error) {
                    console.log("AlertOn fail:");
                    console.log(JSON.stringify(e));
                    fail();
                } else {
                    if (response.statusCode === 200) {
                        console.log("AlertOn success:");
                        console.log(body);
                        var rules = JSON.parse(body).rules;
                        console.log(JSON.stringify(rules));
                        var rooms = [];
                        rules.forEach(function (rule) {
                            console.log(JSON.stringify(rule));
                            rooms.push(rule.rule.name);
                        });
                        console.log(JSON.stringify(rooms));
                        success(rooms);
                    }
                    else {
                        fail();
                    }
                }
            });
        }
    )
        ;
}

var createAlert = function (alert, roomId) {
    return new Promise(function (success, fail) {
        var rule = {};
        request({
            method: 'PUT',
            uri: rulesUrl + roomId,
            auth: alertAuth,
            body: JSON.stringify(alert),
            headers: {
                'Content-type': 'application/json',
                'Accept': 'application/json'
            }
        }, function (error, response, body) {
            if (error) {
                console.log(JSON.stringify(error));
                fail();
            } else {
                console.log("success creating alert");
                console.log(JSON.stringify(response));
                console.log(JSON.stringify(body));
                success();
            }
        });
    })
}

var prepareResults = function (input) {
    var output = {};

    input.forEach(function (result) {
        output[result.uri] = result.content;
    });
    return output;
}

var prepareResult = function (input) {
    var output;
    var uri = input.uri;
    output[uri] = input.content;
    return output;
}

io.on('connection', function (socket) {
    console.log('a user connected');
    socket.emit('message', "220 READY");

    socket.on('disconnect', function () {
        console.log('user disconnected');
    });
    socket.on('listen', function (uri) {
            if (!uriRoomMap[uri]) {
                var roomId = md5(uri).substr(0, 8); // hash the uri to make a room name
                var query;

                // If the URI is a document uri...
                if (uri.endsWith("json")) {
                    query = {
                        "document-query": {
                            uri: uri
                        }
                    }
                } else {
                    query = {
                        "directory-query": {
                            uri: uri,
                            infinite: true
                        }
                    }
                }

                var alert = {
                    "rule": {
                        "search": {
                            "query": query
                        }
                    }
                };
                console.log("creating alert");
                createAlert(alert, roomId).then(
                    function () {
                        var qb = marklogic.queryBuilder;
                        console.log("alert created: " + uri);
                        uriRoomMap[uri] = roomId;
                        socket.join(roomId);
                        if (uri.endsWith("json")) {
                            db.documents.read(uri).result(
                                function (results) {
                                    //console.log(JSON.stringify(results, null, 2));
                                    socket.emit('result', JSON.stringify(
                                        prepareResults(results.documents), null, 2));
                                },
                                function (err) {
                                    console.log("Error");
                                    console.log(JSON.stringify(err));
                                }
                            );
                        } else {
                            db.documents.query(qb.where(qb.directory(uri, true))).result(
                                function (results) {
                                    console.log(JSON.stringify(results, null, 2));
                                    socket.emit('result', JSON.stringify(
                                        prepareResults(results), null, 2));
                                },
                                function (err) {
                                    console.log("Error");
                                    console.log(JSON.stringify(err));
                                }
                            );
                        }
                    });
            } else {
                socket.join(uriRoomMap[uri]);
                if (uri.endsWith("json")) {
                    db.documents.read(uri).result(
                        function (result) {
                            //console.log(JSON.stringify(results, null, 2));
                            socket.emit('result', JSON.stringify(result, null, 2));
                        },
                        function (err) {
                            console.log("Error");
                            console.log(JSON.stringify(err, 2));
                        }
                    );
                } else {
                    var qb = marklogic.queryBuilder;
                    db.documents.query(qb.where(qb.directory(uri))).result(
                        function (results) {
                            var output = prepareResults(results);
                            socket.emit('result', JSON.stringify(output, null, 2));
                        },
                        function (err) {
                            console.log("Error");
                            console.log(JSON.stringify(err));
                        }
                    );
                }

            }
        }
    );

    socket.on('unlisten', function (uri) {
        if (uriRoomMap[uri]) {
            socket.leave(uriRoomMap[uri]);
        }
    });

    socket.on('store', function (msg) {
        try {
            var data = JSON.parse(msg);
            var dir = data.dir;
            if (!dir || !dir.endsWith("/")) {
                dir = dir + "/";
            }
            var doc = data.doc;
            db.documents.write({
                directory: dir,
                extension: 'json',
                contentType: 'application/json',
                content: doc
            }).result(function (result) {
                console.log(JSON.stringify(result));
                var uri = result.documents[0].uri;

                alertOn(uri, doc).then(
                    function (rooms) {
                        var output = {};
                        output[uri] = doc;
                        var message = JSON.stringify(output, 2);
                        console.log(JSON.stringify(rooms));
                        rooms.forEach(
                            function (room) {
                                console.log("Broadcasting to " + room);
                                socket.broadcast.to(room).emit('stored', output);
                            }
                        )
                    }
                )
            }, function (err) {
                console.log(JSON.stringify(err));
            });
        } catch (e) {
            console.log(e);
            socket.error(e);
        }
    });

    socket.on('delete', function (uri) {
        try {
            // Delete a document at the given uri
            // First get a list of all listeners for the URI
            alertOn(uri).then(
                function (rooms) {
                    // try to remove the document
                    db.documents.remove('uri').result(
                        // if successful, then notify all listeners
                        rooms.forEach(
                            function (room) {
                                socket.broadcast.to(room).emit('deleted', uri);
                            }
                        )
                    );
                }
            )
        } catch (e) {
            console.log(e);
            socket.error(e);
        }
    });
});


http.listen(3000, function () {
    console.log('listening on *:3000');
});