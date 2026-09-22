import { createSignalServer } from './server.js'

createSignalServer(8787)
process.stdout.write('Development signaling listening on 127.0.0.1:8787\n')
