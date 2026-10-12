const express = require('express');

const app = express();
const PORT = 3000;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ estado: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});

