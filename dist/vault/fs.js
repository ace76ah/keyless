export const realFs = {
    async readFile(path) {
        const { readFile } = await import('node:fs/promises');
        return readFile(path);
    },
    async writeFileTmp(path, data, mode) {
        const { open, chmod } = await import('node:fs/promises');
        const handle = await open(path, 'wx', mode);
        try {
            await handle.writeFile(data);
            await handle.chmod(mode);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    },
    async fsyncAndRename(tmpPath, finalPath) {
        const { open, rename } = await import('node:fs/promises');
        const { dirname } = await import('node:path');
        const handle = await open(tmpPath, 'r+');
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await rename(tmpPath, finalPath);
        // Persist the directory entry update where the platform supports it.
        const directory = await open(dirname(finalPath), 'r').catch(() => null);
        if (directory) {
            try {
                await directory.sync();
            }
            finally {
                await directory.close();
            }
        }
    },
    async unlink(path) {
        const { unlink } = await import('node:fs/promises');
        try {
            await unlink(path);
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
    },
    async writeFileExclusive(path, data) {
        const { open } = await import('node:fs/promises');
        const handle = await open(path, 'wx', 0o600);
        try {
            await handle.writeFile(data, 'utf8');
            await handle.sync();
        }
        catch (error) {
            await handle.close().catch(() => undefined);
            const { unlink } = await import('node:fs/promises');
            await unlink(path).catch(() => undefined);
            throw error;
        }
        await handle.close();
    },
};
