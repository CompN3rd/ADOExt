import express from 'express';
import path from 'path';
import discoveryRouter from './routes/discovery';
import coreRouter from './routes/core';
import witRouter from './routes/wit';
import gitRouter from './routes/git';
import buildRouter from './routes/build';
import policyRouter from './routes/policy';
import testRouter from './routes/test';
import distributedTaskRouter from './routes/distributedtask';
import screenshotsRouter from './routes/screenshots';

const app = express();
const PORT = parseInt(process.env.MOCK_PORT ?? '3000', 10);

app.use(express.json());

// Serve static assets (icons, avatars)
app.use('/static', express.static(path.join(__dirname, '..', 'static')));
// Serve the compiled extension webview bundles for standalone screenshot pages
app.use('/ext-media', express.static(path.join(__dirname, '..', '..', 'media', 'webviews')));

// Discovery routes must come first (handles /_apis/resourceareas, connectionData, OPTIONS)
app.use(discoveryRouter);

// Screenshot pages (standalone webview previews for documentation)
app.use(screenshotsRouter);

// API routes
app.use(coreRouter);
app.use(witRouter);
app.use(gitRouter);
app.use(buildRouter);
app.use(policyRouter);
app.use(testRouter);
app.use(distributedTaskRouter);

// Catch-all: log unmatched routes so missing location templates are easy to spot
app.use((req, res) => {
    console.warn(`[UNMATCHED] ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: `No mock handler for ${req.method} ${req.path}` });
});

app.listen(PORT, () => {
    console.log(`Mock ADO server running at http://localhost:${PORT}`);
    console.log(`  Org:     mockorg`);
    console.log(`  Project: Acme Platform`);
    console.log(`Set ADO_MOCK_URL=http://localhost:${PORT} in the extension launch config.`);
}).on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`Mock ADO server running at http://localhost:${PORT}`);
    } else {
        console.error(`Failed to start mock server: ${err.message}`);
        process.exit(1);
    }
});
