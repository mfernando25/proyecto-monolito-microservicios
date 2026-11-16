# Guía práctica: observabilidad de microservicios con AWS CloudWatch Logs

## 1. Objetivo

Conectar el microservicio **Pedidos**, ejecutado localmente en Docker Compose, con **Amazon CloudWatch Logs** para observar las operaciones HTTP de su API.

Al ejecutar solicitudes desde WSL con `curl`, registraremos automáticamente:

- Método HTTP: GET, POST, PUT o DELETE.
- Ruta solicitada.
- Código de respuesta HTTP.
- Tiempo de respuesta en milisegundos.
- Fecha y hora del evento.

La lógica CRUD y PostgreSQL se mantienen. No se despliega la aplicación en AWS.

### Arquitectura final

```text
WSL: curl
   |
   v
Docker Compose (local)
   |
   v
Express - microservicio Pedidos
   |  Middleware de registro
   |  AWS SDK for JavaScript
   v
Amazon CloudWatch Logs
   |
   v
CloudWatch Logs Insights
   Consultas, estadísticas y gráficos
```

**Alcance:** esta actividad utiliza CloudWatch Logs. SNS, SQS y DynamoDB se probaron durante una primera propuesta, pero no forman parte de la actividad final y sus recursos propios fueron eliminados.

---

## 2. Preparar WSL

Entorno utilizado durante la práctica:

- Ubuntu 24.04 en WSL2.
- AWS CLI v2.
- Docker Desktop con integración WSL habilitada.
- Proyecto local: `~/proyecto-monolito-microservicios`.

### 2.1. Comprobar Ubuntu

```bash
cat /etc/os-release | head -n 4
```

### 2.2. Instalar AWS CLI v2

Se utilizó el instalador oficial de AWS:

```bash
curl -fsSL https://awscli.amazonaws.com/v2/install.sh | sudo bash -s -- --system
```

Comprobar instalación:

```bash
aws --version
command -v aws
```

En la sesión documentada se instaló AWS CLI **2.40.3**, en `/usr/local/bin/aws`. La versión puede ser distinta si AWS publica una versión posterior.

---

## 3. Configurar credenciales temporales de Learner Lab

Las credenciales se obtienen en Vocareum:

1. Iniciar Learner Lab con **Start Lab**.
2. Abrir **AWS Details → AWS CLI → Show**.
3. Copiar localmente los tres valores: Access Key, Secret Key y Session Token.

No pegar credenciales en el código, archivos del repositorio, capturas públicas ni esta guía.

### 3.1. Crear el directorio de configuración

```bash
mkdir -p ~/.aws
chmod 700 ~/.aws
```

### 3.2. Guardar las credenciales temporales

```bash
nano ~/.aws/credentials
```

Contenido:

```ini
[default]
aws_access_key_id = <ACCESS_KEY_ID>
aws_secret_access_key = <SECRET_ACCESS_KEY>
aws_session_token = <SESSION_TOKEN>
```

Sustituir los marcadores por los valores proporcionados por Vocareum. Guardar con `Ctrl + O`, Enter y salir con `Ctrl + X`.

### 3.3. Configurar región y formato de salida

```bash
nano ~/.aws/config
```

Contenido:

```ini
[default]
region = us-east-1
output = json
```

Aplicar permisos:

```bash
chmod 600 ~/.aws/credentials
chmod 600 ~/.aws/config
```

### 3.4. Verificar configuración y autenticación

```bash
aws configure list
aws sts get-caller-identity --region us-east-1
```

La segunda consulta debe devolver la identidad de la sesión de Learner Lab. Si aparece un error de autenticación, revisar la vigencia y los valores copiados desde Vocareum.

### 3.5. Renovar credenciales en sesiones posteriores

Las credenciales de Learner Lab son temporales. Cuando se inicia una nueva sesión o las credenciales dejan de funcionar:

1. Abrir nuevamente **AWS Details → AWS CLI → Show**.
2. Actualizar los tres valores de `~/.aws/credentials`.
3. Verificar con `aws sts get-caller-identity --region us-east-1`.
4. Reiniciar el contenedor de Pedidos para que el proceso Node.js vuelva a cargar las credenciales:

```bash
cd ~/proyecto-monolito-microservicios/microservicios
docker compose restart pedidos
```

La duración de la sesión de Learner Lab no debe confundirse con una garantía de duración exacta para cada credencial. Comprobar siempre el estado real mediante STS.

---

## 4. Habilitar Docker Desktop en WSL

En Docker Desktop para Windows:

1. **Settings → General:** activar **Use the WSL 2 based engine**.
2. **Settings → Resources → WSL Integration:** activar la integración para Ubuntu.
3. Aplicar los cambios y reiniciar Docker Desktop.

Desde WSL:

```bash
docker context show
docker version
docker compose version
docker info --format 'Sistema: {{.OperatingSystem}} | Motor: {{.Name}} | Logs: {{.LoggingDriver}}'
```

Durante la práctica se observó el motor `Docker Desktop`, contexto `default` y controlador de logs local (`local`).

**Importante:** la aplicación enviará sus propios registros a CloudWatch mediante AWS SDK. No se utiliza el controlador Docker `awslogs`.

---

## 5. Ubicarse en el proyecto y utilizar Docker Compose

Entrar en la carpeta de microservicios:

```bash
cd ~/proyecto-monolito-microservicios/microservicios
```

Esta actividad utiliza Docker Compose, no Minikube/Kubernetes. Para detener Minikube y los port-forward anteriores:

```bash
bash iniciar.sh stop
```

### 5.1. Publicar los puertos locales

En `docker-compose.yml`, los servicios deben exponer los puertos de host usados por las pruebas con curl:

```yaml
usuarios:
  ports:
    - "3101:3001"

productos:
  ports:
    - "3102:3002"

pedidos:
  ports:
    - "3103:3003"
```

El puerto a la izquierda es el puerto local de WSL; el de la derecha es el puerto del contenedor.

### 5.2. Construir y levantar los servicios

```bash
docker compose config -q
docker compose up --build -d
docker compose ps
```

Se espera que estén activos los seis contenedores: usuarios, productos, pedidos y sus tres bases de datos PostgreSQL.

Puertos locales:

| Servicio | URL |
|---|---|
| Usuarios | `http://127.0.0.1:3101` |
| Productos | `http://127.0.0.1:3102` |
| Pedidos | `http://127.0.0.1:3103` |

---

## 6. Crear el grupo y el flujo de CloudWatch Logs

Los comandos se pueden ejecutar desde cualquier directorio de WSL. Para mantener la organización de la práctica, se ejecutaron desde `microservicios/`.

Nombre del grupo:

`/fer-lab/microservicios/pedidos`

Nombre del flujo:

`pedidos-api-wsl`

### 6.1. Crear el grupo de registros

```bash
aws logs create-log-group \
  --log-group-name "/fer-lab/microservicios/pedidos" \
  --region us-east-1
```

### 6.2. Configurar retención de siete días

```bash
aws logs put-retention-policy \
  --log-group-name "/fer-lab/microservicios/pedidos" \
  --retention-in-days 7 \
  --region us-east-1
```

### 6.3. Crear el flujo de registros

```bash
aws logs create-log-stream \
  --log-group-name "/fer-lab/microservicios/pedidos" \
  --log-stream-name "pedidos-api-wsl" \
  --region us-east-1
```

El grupo organiza los registros y el flujo contiene los eventos emitidos por la API.

Si AWS informa que el grupo o el flujo ya existen, no volver a crearlos. Consultar el recurso existente y continuar con la configuración que falte.

---

## 7. Integrar el microservicio Pedidos con CloudWatch

La integración se implementó en el servicio Express existente. No se cambiaron las rutas ni las consultas CRUD de PostgreSQL.

### 7.1. Actualizar la imagen Node.js

Archivo: `pedidos/Dockerfile`

Cambiar la primera línea:

```dockerfile
FROM node:18
```

por:

```dockerfile
FROM node:26-bookworm-slim
```

La imagen Node.js del contenedor se actualiza; no es necesario cambiar Node.js instalado directamente en Ubuntu.

### 7.2. Instalar AWS SDK para CloudWatch Logs

Desde `microservicios/`, ejecutar:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD/pedidos:/app" \
  -w /app \
  node:26-bookworm-slim \
  npm install @aws-sdk/client-cloudwatch-logs
```

Esto actualiza `pedidos/package.json` y `pedidos/package-lock.json`.

En la instalación realizada, npm reportó 23 vulnerabilidades en el árbol de dependencias (3 low, 19 moderate, 1 high). No se ejecutó `npm audit fix --force`, para evitar actualizaciones potencialmente incompatibles en dependencias existentes.

### 7.3. Añadir el cliente de CloudWatch en app.js

Archivo: `pedidos/src/app.js`.

Junto a las importaciones existentes, añadir:

```javascript
const {
    CloudWatchLogsClient,
    PutLogEventsCommand
} = require('@aws-sdk/client-cloudwatch-logs');

const cloudWatchLogs = new CloudWatchLogsClient({
    region: process.env.AWS_REGION || 'us-east-1'
});
```

### 7.4. Añadir middleware de registro HTTP

Insertar el middleware después de crear la instancia Express y antes de declarar las rutas. En la implementación probada quedó antes de `app.use(express.json())`.

```javascript
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
            console.error(
                'Error enviando registro a CloudWatch:',
                error.message
            );
        });
    });

    next();
});
```

El middleware registra cada respuesta HTTP terminada. No guarda el cuerpo de la petición ni los valores enviados por los usuarios.

Si falla el envío del registro a CloudWatch, se escribe el error en la salida del contenedor; el middleware no cambia la respuesta HTTP de la API.

### 7.5. Configurar el servicio Pedidos en Docker Compose

Archivo: `docker-compose.yml`.

Dentro de `services.pedidos.environment`, añadir:

```yaml
      AWS_REGION: us-east-1
      AWS_SHARED_CREDENTIALS_FILE: /root/.aws/credentials
      AWS_CONFIG_FILE: /root/.aws/config
      CLOUDWATCH_LOG_GROUP: /fer-lab/microservicios/pedidos
      CLOUDWATCH_LOG_STREAM: pedidos-api-wsl
```

Dentro del mismo servicio `pedidos`, añadir el montaje de solo lectura:

```yaml
    volumes:
      - ${HOME}/.aws:/root/.aws:ro
```

Esto permite que el SDK dentro del contenedor use las credenciales temporales almacenadas en WSL. Las credenciales no se copian a la imagen, al código ni al repositorio.

### 7.6. Validar, reconstruir y levantar

Desde `microservicios/`:

```bash
docker compose config -q
docker compose up --build -d
docker compose ps
```

---

## 8. Probar la API con curl

Todas las pruebas se realizan contra el servicio Pedidos, publicado localmente en el puerto 3103.

### 8.1. Health check

```bash
curl -sS http://127.0.0.1:3103/health | python3 -m json.tool
```

### 8.2. GET: consultar pedidos

```bash
curl -sS http://127.0.0.1:3103/pedidos | python3 -m json.tool
```

### 8.3. POST: crear un pedido

```bash
curl -sS -X POST http://127.0.0.1:3103/pedidos \
  -H "Content-Type: application/json" \
  -d '{"usuario_id":3,"producto_id":3,"cantidad":2}' \
  | python3 -m json.tool
```

La API devuelve el pedido creado y su identificador. Anotar el ID devuelto para utilizarlo en las pruebas PUT y DELETE.

### 8.4. PUT: actualizar el pedido

Reemplazar `<ID_PEDIDO>` por el identificador devuelto por POST:

```bash
curl -sS -X PUT http://127.0.0.1:3103/pedidos/<ID_PEDIDO> \
  -H "Content-Type: application/json" \
  -d '{"usuario_id":3,"producto_id":3,"cantidad":5}' \
  | python3 -m json.tool
```

### 8.5. DELETE: eliminar el pedido de prueba

```bash
curl -sS -X DELETE http://127.0.0.1:3103/pedidos/<ID_PEDIDO> \
  | python3 -m json.tool
```

### 8.6. Probar un error de validación HTTP 400

La cantidad debe ser un entero positivo. La siguiente solicitud usa cantidad cero y no debe insertar un pedido:

```bash
curl -sS -X POST http://127.0.0.1:3103/pedidos \
  -H "Content-Type: application/json" \
  -d '{"usuario_id":3,"producto_id":3,"cantidad":0}' \
  | python3 -m json.tool
```

La respuesta esperada es HTTP 400.

---

## 9. Consultar registros desde WSL

Para recuperar los eventos del flujo:

```bash
aws logs get-log-events \
  --log-group-name "/fer-lab/microservicios/pedidos" \
  --log-stream-name "pedidos-api-wsl" \
  --region us-east-1 \
  --query "events[].message" \
  --output json
```

Cada mensaje contiene un JSON con `timestamp`, `method`, `path`, `statusCode` y `durationMs`.

---

## 10. Consultar y visualizar en la consola CloudWatch

1. Abrir AWS Management Console en región **US East (N. Virginia) / us-east-1**.
2. Entrar en **CloudWatch → Registros → Análisis de registros (Logs Insights)**.
3. Seleccionar el grupo `/fer-lab/microservicios/pedidos`.
4. Seleccionar el intervalo de tiempo que incluya las pruebas (por ejemplo, última hora).
5. Escribir una consulta y pulsar **Ejecutar**.

### 10.1. Ver las solicitudes

```sql
fields @timestamp, method, path, statusCode, durationMs
| sort @timestamp desc
| limit 100
```

### 10.2. Estadísticas por método HTTP

```sql
stats
    count(*) as solicitudes,
    avg(durationMs) as promedioMs,
    max(durationMs) as maximoMs
by method
| sort method asc
```

Esta consulta permite comparar la cantidad de peticiones, el tiempo promedio y el tiempo máximo por método.

En la primera tanda de pruebas, antes de generar el POST inválido, se observaron estos valores:

| Método | Solicitudes | Promedio (ms) | Máximo (ms) |
|---|---:|---:|---:|
| DELETE | 1 | 15 | 15 |
| GET | 3 | 14 | 35 |
| POST | 2 | 62 | 107 |
| PUT | 1 | 43 | 43 |

Son resultados de una muestra pequeña de práctica, no una evaluación de rendimiento estadísticamente representativa. Los colores del gráfico los asigna CloudWatch automáticamente; no significan éxito, advertencia o error.

### 10.3. Crear gráfico de solicitudes por método

```sql
stats count(*) as solicitudes by method
| sort method asc
```

Seleccionar la visualización de barras.

### 10.4. Encontrar solicitudes fallidas

```sql
fields @timestamp, method, path, statusCode, durationMs
| filter statusCode >= 400
| sort @timestamp desc
```

La prueba con `cantidad: 0` produjo un registro POST con HTTP 400.

### 10.5. Agrupar solicitudes exitosas y fallidas

```sql
fields if(statusCode >= 400, "Error", "Éxito") as resultado
| stats count(*) as solicitudes by resultado
```

Se puede seleccionar un gráfico circular para visualizar la distribución.

---

## 11. Resultados comprobados durante la práctica

Se verificó el siguiente flujo:

- `GET /health`: HTTP 200.
- `GET /pedidos`: HTTP 200.
- `POST /pedidos`: HTTP 201.
- `PUT /pedidos/11`: HTTP 200.
- `DELETE /pedidos/11`: HTTP 200.
- `POST /pedidos` con cantidad cero: HTTP 400.

Los siete primeros eventos CRUD/health y el evento fallido se visualizaron en CloudWatch Logs. Logs Insights permitió consultar los campos JSON, agrupar por método y filtrar el error HTTP 400.

Durante las pruebas se creó el pedido ID 10 y quedó en la base de datos. El pedido ID 11 se actualizó y luego se eliminó. El POST inválido no creó un registro.

---

## 12. Limpieza y cierre

### 12.1. Detener los contenedores sin borrar los volúmenes de PostgreSQL

Desde `microservicios/`:

```bash
docker compose down
```

No añadir `-v` si se desea conservar los datos de PostgreSQL.

### 12.2. Conservar registros durante siete días

El grupo se configuró con retención de siete días. Los eventos se eliminarán según esa política.

Comprobar grupo y retención:

```bash
aws logs describe-log-groups \
  --log-group-name-prefix "/fer-lab/microservicios/pedidos" \
  --region us-east-1 \
  --query "logGroups[].{Grupo:logGroupName,Retencion:retentionInDays}" \
  --output table
```

### 12.3. Eliminar el grupo cuando ya no se necesite

Esta operación elimina el grupo y los registros almacenados. Ejecutarla solo después de guardar las evidencias necesarias:

```bash
aws logs delete-log-group \
  --log-group-name "/fer-lab/microservicios/pedidos" \
  --region us-east-1
```

---

## 13. Notas importantes

- La actividad se ejecuta localmente en WSL con Docker Desktop; la aplicación no se despliega en AWS.
- AWS CLI y AWS SDK utilizan credenciales temporales de Learner Lab. Renovarlas cuando corresponda.
- No versionar `~/.aws`, archivos de credenciales, tokens ni secretos.
- El contenedor Pedidos monta `~/.aws` en modo solo lectura.
- La aplicación envía registros mediante AWS SDK; el controlador de logs de Docker puede seguir siendo `local`.
- El grupo de registros tiene retención de siete días. La ingesta, almacenamiento y consultas de CloudWatch pueden consumir presupuesto del Learner Lab; no asumir que son gratuitos.
- No modificar el topic interno `RedshiftSNS`, ni los roles, políticas, funciones o reglas de monitorización de AWS Academy.
- La consulta de Logs Insights depende del rango temporal seleccionado. Si no aparecen eventos, ampliar el intervalo y comprobar la región.
- Si se actualizan las credenciales de Learner Lab, reiniciar el contenedor Pedidos para renovar el contexto de credenciales del proceso.
