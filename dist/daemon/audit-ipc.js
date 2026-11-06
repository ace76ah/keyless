import net from 'node:net';
import { resolveIpcAddress } from './ipc.js';
export async function sendProxyAudit(socketPath, event) {
    await new Promise((resolve, reject) => {
        const socket = net.createConnection(resolveIpcAddress(socketPath));
        let buffer = '';
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('daemon audit IPC timeout')); }, 5000);
        socket.once('connect', () => socket.write(`${JSON.stringify({ command: 'audit_proxy_request', args: event })}\n`));
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            const newline = buffer.indexOf('\n');
            if (newline < 0)
                return;
            clearTimeout(timer);
            socket.end();
            try {
                const response = JSON.parse(buffer.slice(0, newline));
                if (!response.ok)
                    reject(new Error(response.error || 'audit append failed'));
                else
                    resolve();
            }
            catch (error) {
                reject(error);
            }
        });
        socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
}
