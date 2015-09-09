# ML-Socket

ML-Socket is a framework to allow pseudo realtime bidirectional communication between a MarkLogic database, and client applications.

It makes use of the Socket.io library to allow clients to subscribe to database paths, and to push updates to the clients when documents are added, modified, or deleted within that path.

A simple UI is provided to allow the application to be demonstrated.

## Message types

From client to server, there are four supported message types:

- Listen: takes a path as message value, the server will return the current state of that path and subscribe the users to update messages on all documents within that path.
- Unlisten: unsubscribes a client from that path
- Store: takes a JSON document as message value and stores that document in the database
- Delete: not yet implemented
- Patch: not yet implemented

From server to client, there are four supported message types:

- result: a JSON document containing the state of a newly subscribed path
- stored: a JSON document containing a newly stored document under a subscribed path
- deleted: the URI of a deleted document
- patched: the new state of a JSON document under a subscribed path that has been patched by a client