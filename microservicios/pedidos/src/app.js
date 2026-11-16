const express = require('express');
const pool = require('./db');
const {
    CloudWatchLogsClient,
    PutLogEventsCommand
} = require('@aws-sdk/client-cloudwatch-logs');

const cloudWatchLogs = new CloudWatchLogsClient({
    region: process.env.AWS_REGION || 'us-east-1'
});

const app = express();

async function validarReferencias(usuarioId, productoId) {
    const [usuario, producto] = await Promise.all([
        fetch(`${process.env.USUARIOS_URL}/usuarios/${usuarioId}`),
        fetch(`${process.env.PRODUCTOS_URL}/productos/${productoId}`)
    ]);

    if (usuario.status === 404 || producto.status === 404) {
        return false;
    }

    if (!usuario.ok || !producto.ok) {
        throw new Error('Error al consultar Usuarios o Productos');
    }

    return true;
}


app.use((req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
        const logGroupName = process.env.CLOUDWATCH_LOG_GROUP;
        const logStreamName = process.env.CLOUDWATCH_LOG_STREAM;

        if (!logGroupName || !logStreamName) return;

        const logEvent = {
            timestamp: Date.now(),
            message: JSON.stringify({
                timestamp: new Date().toISOString(),
                method: req.method,
                path: req.originalUrl,
                statusCode: res.statusCode,
                durationMs: Date.now() - startTime
            })
        };

        cloudWatchLogs.send(new PutLogEventsCommand({
            logGroupName,
            logStreamName,
            logEvents: [logEvent]
        })).catch(error => {
            console.error('Error enviando registro a CloudWatch:', error.message);
        });
    });

    next();
});

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ estado: 'ok', servicio: 'pedidos' });
});

app.get('/pedidos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pedidos');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: 'Error al consultar pedidos'
        });
    }
});

app.post('/pedidos', async (req, res) => {
    const { usuario_id, producto_id, cantidad } = req.body;

    if (![usuario_id, producto_id, cantidad].every(
        valor => Number.isInteger(Number(valor)) && Number(valor) > 0
    )) {
        return res.status(400).json({
            error: 'Los identificadores y la cantidad deben ser enteros positivos'
        });
    }

    try {
        const referenciasValidas = await validarReferencias(
            usuario_id,
            producto_id
        );

        if (!referenciasValidas) {
            return res.status(400).json({
                error: 'El usuario o producto indicado no existe'
            });
        }

        const result = await pool.query(
            `INSERT INTO pedidos (usuario_id, producto_id, cantidad)
             VALUES ($1, $2, $3) RETURNING *`,
            [usuario_id, producto_id, cantidad]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear pedido' });
    }
});

app.put('/pedidos/:id', async (req, res) => {
    const { usuario_id, producto_id, cantidad } = req.body;

    if (![usuario_id, producto_id, cantidad].every(
        valor => Number.isInteger(Number(valor)) && Number(valor) > 0
    )) {
        return res.status(400).json({
            error: 'Los identificadores y la cantidad deben ser enteros positivos'
        });
    }

    try {
        const referenciasValidas = await validarReferencias(
            usuario_id,
            producto_id
        );

        if (!referenciasValidas) {
            return res.status(400).json({
                error: 'El usuario o producto indicado no existe'
            });
        }

        const result = await pool.query(
            `UPDATE pedidos
             SET usuario_id = $1, producto_id = $2, cantidad = $3
             WHERE id = $4 RETURNING *`,
            [usuario_id, producto_id, cantidad, req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar pedido' });
    }
});


app.delete('/pedidos/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM pedidos WHERE id = $1 RETURNING *',
            [req.params.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        res.json({
            mensaje: 'Pedido eliminado',
            pedido: result.rows[0]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar pedido' });
    }
});


module.exports = app;
