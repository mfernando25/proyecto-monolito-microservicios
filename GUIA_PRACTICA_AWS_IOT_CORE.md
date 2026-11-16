# Guía práctica: estación IoT virtual con AWS IoT Core y Python en WSL

## 1. Objetivo

Simular una estación de sensores desde **Python ejecutado localmente en Ubuntu/WSL** y enviar lecturas a **AWS IoT Core** mediante MQTT sobre TLS.

La estación genera valores de temperatura y humedad, los publica en un tema MQTT y permite observar los mensajes recibidos desde el **MQTT Test Client** de la consola de AWS.

Durante esta primera etapa se comprobó el flujo de telemetría:

- Generación local de datos simulados.
- Autenticación del dispositivo mediante certificado X.509.
- Conexión segura al endpoint de AWS IoT Core.
- Publicación de mensajes MQTT.
- Recepción y visualización de los mensajes en AWS Console.

**Alcance actual:** el programa envía cinco lecturas y termina. Todavía no mantiene una conexión permanente, no recibe comandos remotos, no almacena telemetría en S3 y no realiza análisis BI.

### Arquitectura implementada

```text
Ubuntu 24.04 / WSL2
└── Python: app.py
    ├── Genera temperatura y humedad simuladas
    ├── Se autentica con certificado X.509
    └── Publica mensajes MQTT
             |
             | MQTT sobre TLS (puerto 8883)
             v
AWS IoT Core
└── Tema: estacion-iot-wsl/telemetry
             |
             v
AWS Console
└── MQTT Test Client
    └── Suscripción y visualización de mensajes JSON
```

**La aplicación y el dispositivo simulado se ejecutan localmente.** No se creó una instancia EC2 para esta práctica.

---

## 2. Entorno utilizado

| Elemento | Configuración observada |
|---|---|
| Plataforma local | Ubuntu 24.04 sobre WSL2 |
| Python | Python 3.12 dentro del entorno virtual |
| AWS CLI | AWS CLI v2; la versión comprobada fue 2.34.0 |
| SDK de IoT | AWS IoT Device SDK for Python v2 (`awsiotsdk`) |
| Versión instalada de `awsiotsdk` | 1.31.0 |
| Versión de `awscrt` instalada | 0.36.1 |
| AWS Academy | Learner Lab, acceso docente mediante Vocareum / My Student View |
| Región utilizada | `us-east-1` (US East, N. Virginia) |
| Dispositivo IoT | `estacion-iot-wsl` |
| Política IoT | `fer-estacion-iot-policy` |
| Tema MQTT | `estacion-iot-wsl/telemetry` |

La guía de Learner Lab compartida para este entorno indica que AWS IoT Core puede utilizar `LabRole`. La política de permisos compartida también contempla acciones `iot:*` en las regiones autorizadas. Esto no significa que cualquier operación o configuración esté garantizada: se deben comprobar las acciones concretas y las restricciones de la cuenta.

---

## 3. Preparar el proyecto en WSL

### 3.1. Crear la carpeta del proyecto

```bash
cd ~/proyectos-aws
mkdir -p estacion-iot/certificados
cd estacion-iot
```

La carpeta `certificados/` almacenará los certificados y claves del dispositivo.

### 3.2. Crear y activar el entorno virtual

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Cuando el entorno está activo, la terminal muestra el prefijo `(.venv)`.

### 3.3. Instalar el SDK de AWS IoT

```bash
python -m pip install --upgrade pip
pip install awsiotsdk
pip freeze > requirements.txt
```

Comprobar la instalación:

```bash
python -c "import awsiot, awscrt; print('AWS IoT SDK instalado')"
```

`awsiotsdk` permite establecer la conexión MQTT segura desde Python utilizando certificados X.509.

### 3.4. Estructura de directorios

La estructura utilizada en la práctica es:

```text
proyectos-aws/
└── estacion-iot/
    ├── .venv/
    ├── certificados/
    │   ├── AmazonRootCA1.pem
    │   ├── device.pem.crt
    │   └── private.pem.key
    ├── app.py
    └── requirements.txt
```

---

## 4. Credenciales de AWS CLI y certificados IoT: son mecanismos diferentes

Para esta práctica se utilizan dos mecanismos de autenticación distintos:

1. **Credenciales temporales de Learner Lab:** se almacenan en `~/.aws/credentials` y las utiliza AWS CLI para administrar o consultar recursos de la cuenta.
2. **Certificado X.509 del dispositivo:** se utiliza desde `app.py` para autenticar el dispositivo ante el endpoint MQTT de AWS IoT Core.

Las credenciales de AWS CLI no sustituyen al certificado X.509 en la conexión MQTT.

La autenticación de AWS CLI ya había sido comprobada previamente en WSL con:

```bash
aws sts get-caller-identity --region us-east-1
```

No incluir credenciales temporales, tokens, claves privadas ni certificados privados en el código, repositorios o capturas compartidas.

---

## 5. Crear la política de AWS IoT Core

### 5.1. Abrir AWS IoT Core

1. Entrar en AWS Management Console mediante el laboratorio de Vocareum.
2. Seleccionar la región **US East (N. Virginia) – `us-east-1`**.
3. Buscar y abrir **AWS IoT Core**.
4. En el menú de navegación, entrar en **Seguridad → Políticas**.
5. Seleccionar **Crear política**.

### 5.2. Nombre de la política

```text
fer-estacion-iot-policy
```

### 5.3. Documento de política utilizado

El documento final correcto de la primera etapa autoriza:

- Conectar únicamente al cliente MQTT `estacion-iot-wsl`.
- Publicar únicamente en el tema `estacion-iot-wsl/telemetry`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "iot:Connect",
      "Resource": "arn:aws:iot:us-east-1:<AWS_ACCOUNT_ID>:client/estacion-iot-wsl"
    },
    {
      "Effect": "Allow",
      "Action": "iot:Publish",
      "Resource": "arn:aws:iot:us-east-1:<AWS_ACCOUNT_ID>:topic/estacion-iot-wsl/telemetry"
    }
  ]
}
```

Reemplazar `<AWS_ACCOUNT_ID>` por el ID de la cuenta Learner Lab correspondiente. En la cuenta utilizada durante esta práctica, el ID observado fue `039949401137`.

**Detalle importante del ARN:** para el recurso de conexión se utiliza `client/estacion-iot-wsl` (barra después de `client`), no `client:estacion-iot-wsl`.

### 5.4. Corrección aplicada durante la práctica

La primera versión de la política contenía el ARN de conexión con `client:`. La conexión MQTT fallaba aunque el certificado estuviera activo y asociado a la política.

Se corrigió el ARN a `client/estacion-iot-wsl` y se guardó una nueva versión predeterminada de la misma política. La consola mostró la **versión 2** como versión predeterminada.

No se creó una política adicional. Se actualizó `fer-estacion-iot-policy`.


---

## 6. Crear el objeto (Thing) y el certificado del dispositivo

### 6.1. Crear un objeto

En AWS IoT Core:

1. Abrir **Todos los dispositivos → Objetos**.
2. Seleccionar **Crear objetos**.
3. Seleccionar **Crear un solo objeto**.
4. Introducir el nombre:

```text
estacion-iot-wsl
```

5. No seleccionar un tipo de objeto.
6. No agregar atributos, grupos ni grupo de facturación.
7. Mantener la opción de sombra del dispositivo desactivada para esta primera práctica.
8. Continuar.

El objeto representa el dispositivo lógico registrado en AWS IoT Core. En esta práctica, el dispositivo es un programa Python ejecutado en WSL, no un sensor físico.

### 6.2. Generar certificado

En la pantalla de configuración del certificado:

1. Seleccionar **Generar automáticamente un certificado nuevo**.
2. Continuar.
3. En la pantalla de políticas, seleccionar `fer-estacion-iot-policy`.
4. Seleccionar **Crear un objeto**.

AWS genera el certificado del dispositivo y la clave privada, y asocia la política seleccionada al certificado.

### 6.3. Descargar los archivos

Descargar los siguientes archivos desde la pantalla de creación:

| Archivo descargado | Nombre local utilizado | Función |
|---|---|---|
| Certificado del dispositivo (`*-certificate.pem.crt`) | `device.pem.crt` | Identifica al dispositivo |
| Clave privada (`*-private.pem.key`) | `private.pem.key` | Permite demostrar la posesión de la clave asociada al certificado |
| Amazon Root CA 1 | `AmazonRootCA1.pem` | Permite verificar el certificado del servidor AWS |

La clave privada se debe descargar durante el proceso de creación; AWS no permite volver a descargarla desde la consola después de cerrar ese paso. Guardarla localmente y no compartirla.

### 6.4. Copiar los archivos a WSL

Desde WSL, abrir la carpeta de certificados en el Explorador de Windows:

```bash
cd ~/proyectos-aws/estacion-iot
explorer.exe "$(wslpath -w "$PWD/certificados")"
```

Copiar desde Descargas de Windows los tres archivos descargados a la carpeta `certificados/`.

Renombrar el certificado y la clave privada. Sustituir los nombres originales por los nombres descargados si fuera necesario:

```bash
mv certificados/*-certificate.pem.crt certificados/device.pem.crt
mv certificados/*-private.pem.key certificados/private.pem.key
```

Si ya se habían renombrado manualmente, no volver a ejecutar esos dos comandos.

### 6.5. Proteger la clave privada y limpiar metadatos de Windows

```bash
chmod 600 certificados/private.pem.key
rm -f certificados/*.Zone.Identifier
ls -lh certificados/
```

La comprobación realizada mostró estos tres archivos:

```text
AmazonRootCA1.pem
 device.pem.crt
 private.pem.key
```

El archivo `private.pem.key` quedó con permisos `-rw-------` (600). Los archivos `:Zone.Identifier` eran metadatos añadidos por Windows y no eran certificados.

**No subir `certificados/` a GitHub ni compartir `private.pem.key`.**

---

## 7. Obtener el endpoint de datos de AWS IoT Core

El endpoint de datos es específico de la cuenta y región. Se obtuvo desde WSL mediante AWS CLI:

```bash
aws iot describe-endpoint \
  --endpoint-type iot:Data-ATS \
  --region us-east-1
```

Endpoint observado durante esta práctica:

```text
a2ytcqm7z1zw6v-ats.iot.us-east-1.amazonaws.com
```

Si se repite la práctica en otra cuenta o región, obtener el endpoint de nuevo. No asumir que el endpoint de este documento corresponde a otra cuenta.

---

## 8. Preparar el MQTT Test Client en AWS Console

1. Abrir **AWS IoT Core** en `us-east-1`.
2. En el menú izquierdo, entrar en **Probar → Cliente de prueba de MQTT**.
3. Mantener la conexión del cliente de prueba.
4. En **Suscribirse a un tema**, introducir:

```text
estacion-iot-wsl/telemetry
```

5. Pulsar **Suscribirse**.

Dejar abierta esta pestaña. El cliente de prueba mostrará los mensajes que se publiquen en ese tema después de establecer la suscripción.

> Un mensaje de prueba publicado manualmente desde la consola (`Hello from AWS IoT console`) no es una lectura generada por el programa Python. Para identificar la telemetría, comprobar los campos `device_id`, `sequence`, `temperature_c` y `humidity_pct`.

---

## 9. Implementar el dispositivo virtual en Python

### 9.1. Configuración utilizada

| Variable | Valor |
|---|---|
| Endpoint | `a2ytcqm7z1zw6v-ats.iot.us-east-1.amazonaws.com` |
| Client ID | `estacion-iot-wsl` |
| Tema MQTT | `estacion-iot-wsl/telemetry` |
| QoS | `1` (`AT_LEAST_ONCE`) |
| Número de lecturas | 5 |
| Intervalo entre publicaciones | 3 segundos |
| Temperatura simulada | Aleatoria entre 20.0 y 30.0 °C |
| Humedad simulada | Aleatoria entre 40.0 y 80.0 % |

### 9.2. Crear `app.py`

Desde `~/proyectos-aws/estacion-iot`:

```bash
nano app.py
```

Contenido utilizado para la primera etapa:

```python
import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path

from awsiot import mqtt_connection_builder
from awscrt import mqtt

# Configuración del dispositivo
ENDPOINT = "a2ytcqm7z1zw6v-ats.iot.us-east-1.amazonaws.com"
CLIENT_ID = "estacion-iot-wsl"
TOPIC = "estacion-iot-wsl/telemetry"

# Ubicación de los certificados
BASE_DIR = Path(__file__).resolve().parent
CERT_DIR = BASE_DIR / "certificados"

CERTIFICATE = CERT_DIR / "device.pem.crt"
PRIVATE_KEY = CERT_DIR / "private.pem.key"
ROOT_CA = CERT_DIR / "AmazonRootCA1.pem"


def main():
    connection = mqtt_connection_builder.mtls_from_path(
        endpoint=ENDPOINT,
        cert_filepath=str(CERTIFICATE),
        pri_key_filepath=str(PRIVATE_KEY),
        ca_filepath=str(ROOT_CA),
        client_id=CLIENT_ID,
        clean_session=True,
        keep_alive_secs=30
    )

    conectado = False

    try:
        print("Conectando con AWS IoT Core...")

        connection.connect().result(timeout=15)
        conectado = True

        print("Dispositivo conectado correctamente.\n")

        for numero in range(1, 6):
            temperatura = round(random.uniform(20, 30), 1)
            humedad = round(random.uniform(40, 80), 1)

            mensaje = {
                "device_id": CLIENT_ID,
                "sequence": numero,
                "temperature_c": temperatura,
                "humidity_pct": humedad,
                "status": "normal",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

            future, packet_id = connection.publish(
                topic=TOPIC,
                payload=json.dumps(mensaje),
                qos=mqtt.QoS.AT_LEAST_ONCE
            )

            future.result(timeout=10)

            print(f"Lectura {numero}/5 enviada")
            print(f"Temperatura: {temperatura} °C")
            print(f"Humedad: {humedad} %")
            print("-" * 30)

            time.sleep(3)

    except Exception as error:
        print("Error de comunicación:", error)

    finally:
        if conectado:
            connection.disconnect().result(timeout=10)
            print("\nDispositivo desconectado.")


if __name__ == "__main__":
    main()
```

### 9.3. Ejecutar el dispositivo

Con el entorno virtual activo:

```bash
python app.py
```

La salida esperada incluye:

```text
Conectando con AWS IoT Core...
Dispositivo conectado correctamente.

Lectura 1/5 enviada
Temperatura: ... °C
Humedad: ... %
...
Lectura 5/5 enviada
...
Dispositivo desconectado.
```

Los valores son aleatorios; no deben coincidir exactamente con los de una ejecución anterior.

---

## 10. Validar los mensajes en AWS Console

Con `app.py` ejecutándose en WSL y el MQTT Test Client suscrito a `estacion-iot-wsl/telemetry`, deben aparecer mensajes JSON similares a:

```json
{
  "device_id": "estacion-iot-wsl",
  "sequence": 1,
  "temperature_c": 25.0,
  "humidity_pct": 69.4,
  "status": "normal",
  "timestamp": "2026-11-16T...+00:00"
}
```

En una de las ejecuciones comprobadas en consola se observaron, entre otros, `sequence: 4` y `sequence: 5`, junto con valores de temperatura y humedad. Los valores cambian en cada ejecución.

Para repetir la prueba:

1. Mantener activa la suscripción en MQTT Test Client.
2. Ejecutar `python app.py` desde WSL.
3. Observar los mensajes que llegan al tema.

Si se pulsa **Borrar** en el MQTT Test Client, se limpia el panel visual de mensajes; no se eliminan recursos ni mensajes del programa local.

---

## 11. Diagnóstico del problema de conexión encontrado

La primera ejecución de `app.py` terminó con:

```text
AWS_ERROR_MQTT_UNEXPECTED_HANGUP: The connection was closed unexpectedly.
```

Se realizaron estas comprobaciones antes de cambiar certificados:

### 11.1. Certificado asociado al objeto

```bash
CERT_ARN=$(aws iot list-thing-principals \
  --thing-name estacion-iot-wsl \
  --region us-east-1 \
  --query "principals[0]" \
  --output text)

echo "$CERT_ARN"
```

El resultado devolvió un ARN de certificado asociado a `estacion-iot-wsl`.

### 11.2. Estado del certificado

```bash
CERT_ID="${CERT_ARN##*/}"

aws iot describe-certificate \
  --certificate-id "$CERT_ID" \
  --region us-east-1 \
  --query "certificateDescription.{ID:certificateId,Status:status}" \
  --output table
```

Resultado observado: `ACTIVE`.

### 11.3. Política asociada

```bash
aws iot list-attached-policies \
  --target "$CERT_ARN" \
  --region us-east-1 \
  --output table
```

Resultado observado: `fer-estacion-iot-policy` estaba asociada al certificado.

### 11.4. Verificar que la clave corresponde al certificado

```bash
openssl x509 -in certificados/device.pem.crt -pubkey -noout \
  | openssl pkey -pubin -outform DER | sha256sum

openssl pkey -in certificados/private.pem.key -pubout -outform DER \
  | sha256sum
```

Los dos hashes observados fueron idénticos:

```text
36f342da32d37b3e8ac5a6b9e5e7383b44087741d2b198f730c1cefe51ec71fc
```

Esto comprobó que la clave privada correspondía al certificado descargado.

### 11.5. Verificar TLS

```bash
openssl s_client \
  -connect a2ytcqm7z1zw6v-ats.iot.us-east-1.amazonaws.com:8883 \
  -servername a2ytcqm7z1zw6v-ats.iot.us-east-1.amazonaws.com \
  -CAfile certificados/AmazonRootCA1.pem \
  -cert certificados/device.pem.crt \
  -key certificados/private.pem.key \
  -tls1_2 -brief </dev/null
```

Resultado observado:

```text
CONNECTION ESTABLISHED
Protocol version: TLSv1.2
Verification: OK
```

### 11.6. Causa identificada y corrección

La política inicial tenía mal formado el ARN de `iot:Connect`:

```text
...:client:estacion-iot-wsl
```

Se corrigió a:

```text
...:client/estacion-iot-wsl
```

Se guardó la corrección como versión 2 predeterminada de `fer-estacion-iot-policy`. Después de esa corrección, `python app.py` pudo conectarse y publicar las cinco lecturas, que aparecieron en MQTT Test Client.

**Conclusión del diagnóstico:** la conexión TLS y el par certificado/clave funcionaban. El problema estaba en el ARN del recurso autorizado para `iot:Connect` en la política IoT.

---

## 12. Estado actual de la práctica

### 12.1. Elementos creados en AWS

| Recurso | Nombre / identificador | Estado comprobado |
|---|---|---|
| Política IoT | `fer-estacion-iot-policy` | Creada; versión 2 corregida y predeterminada |
| Thing | `estacion-iot-wsl` | Creado |
| Certificado X.509 | Certificado asociado al Thing | `ACTIVE` |
| Asociación de política | Política adjunta al certificado | Comprobada |
| Endpoint de datos | `a2ytcqm7z1zw6v-ats.iot.us-east-1.amazonaws.com` | Obtenido |
| Tema MQTT | `estacion-iot-wsl/telemetry` | Suscripción y recepción comprobadas |

### 12.2. Funcionalidades completadas

- [x] Proyecto independiente `~/proyectos-aws/estacion-iot`.
- [x] Entorno virtual Python.
- [x] Instalación de `awsiotsdk`.
- [x] Política IoT de conexión y publicación.
- [x] Thing `estacion-iot-wsl`.
- [x] Certificado X.509 activo y política asociada.
- [x] Certificados copiados a WSL y clave privada protegida con `chmod 600`.
- [x] Endpoint MQTT obtenido mediante AWS CLI.
- [x] MQTT Test Client suscrito al tema de telemetría.
- [x] Conexión MQTT segura desde Python.
- [x] Publicación de cinco lecturas simuladas.
- [x] Recepción y visualización de las lecturas en AWS Console.

### 12.3. Funcionalidades todavía no implementadas

- [ ] Ejecución continua del dispositivo.
- [ ] Suscripción MQTT desde Python a un tema de comandos.
- [ ] Recepción y ejecución de comandos remotos.
- [ ] Reglas IoT para filtrar o transformar telemetría.
- [ ] Almacenamiento automático de lecturas en S3.
- [ ] Consultas analíticas con Athena.
- [ ] Dashboard BI.

El código actual envía cinco mensajes y se desconecta. No debe describirse como un dispositivo persistente o bidireccional.

---

## 13. Seguridad, restricciones y costes

- Trabajar en la región `us-east-1`, que está dentro de las regiones indicadas por la documentación compartida de Learner Lab.
- La guía de Learner Lab compartida indica que AWS IoT Core puede asumir `LabRole`; la política IAM compartida incluye permisos `iot:*` condicionados por región. Las operaciones concretas deben verificarse en la cuenta.
- Mantener el certificado activo y asociado únicamente a la política necesaria.
- No ampliar los permisos a `iot:*` en la política del dispositivo para esta práctica básica.
- Proteger `private.pem.key` con permisos restrictivos (`chmod 600`).
- No publicar la clave privada ni añadir la carpeta `certificados/` a repositorios.
- Las credenciales de AWS CLI son temporales y se renuevan desde Vocareum; son distintas del certificado X.509 del dispositivo.
- Learner Lab tiene presupuesto limitado. La consola compartida mostró un presupuesto de USD 50. No asumir que las operaciones de AWS IoT Core son gratuitas ni extrapolar tarifas sin consultar los precios y el consumo de la cuenta.
- El dispositivo es local; no se inició EC2 ni se desplegó infraestructura de cómputo para generar la telemetría.
- No modificar ni eliminar los recursos internos preconfigurados por AWS Academy, como `RedshiftSNS`, las funciones Lambda de monitorización ni sus roles y reglas asociados.

### 13.1. Detener la práctica

El programa actual termina automáticamente después de enviar cinco lecturas y desconectarse. Si se modifica para ejecutarse de forma continua en una etapa posterior, se podrá detener desde WSL con `Ctrl + C`.

### 13.2. Recursos que se conservan

Por ahora se recomienda conservar:

- Thing `estacion-iot-wsl`.
- Certificado y clave privada del dispositivo.
- Política `fer-estacion-iot-policy`.
- Carpeta local `certificados/`.

Estos recursos serán reutilizados en los escenarios siguientes. No ejecutar limpieza o eliminación de certificados hasta decidir que la práctica completa ya terminó.

---

## 14. Escenarios previstos para continuar

Los siguientes escenarios son propuestas de evolución. **No están implementados ni probados todavía.** Se desarrollarán como prácticas pequeñas e independientes, aprovechando la estación IoT ya creada.

### Escenario 1. Filtrado de lecturas y generación de alertas con IoT Rules

**Objetivo:** procesar automáticamente la telemetría y detectar condiciones como temperatura superior a 28 °C.

**Posibles actividades:**

- Crear una regla IoT que consulte el tema `estacion-iot-wsl/telemetry`.
- Aplicar una condición SQL sobre `temperature_c`.
- Enviar los mensajes que cumplan la condición a un tema de alertas, por ejemplo `estacion-iot-wsl/alerts`.
- Observar las alertas desde MQTT Test Client.

**Conceptos:** IoT Rules, SQL de reglas, filtros de eventos y publicación a otro tema.

**Pendiente de verificar:** acción concreta de la regla y permisos/rol IAM requeridos en Learner Lab.

### Escenario 2. Almacenamiento automático de telemetría en Amazon S3

**Objetivo:** conservar lecturas IoT para análisis posterior.

**Posibles actividades:**

- Crear un bucket exclusivo para la práctica.
- Configurar una regla IoT para enviar mensajes a S3.
- Organizar los archivos por fecha o prefijo.
- Comprobar desde la consola S3 que las lecturas se almacenan.

**Conceptos:** persistencia, integración de servicios, objetos S3 y datos históricos.

**Pendiente de verificar:** permisos de escritura del rol que utilice la acción S3 de IoT Rules y configuración de la regla.

### Escenario 3. Análisis de telemetría con Amazon Athena

**Objetivo:** analizar las lecturas históricas almacenadas en S3 mediante SQL.

**Posibles actividades:**

- Consultar archivos de telemetría en S3.
- Crear o configurar el catálogo de datos necesario con AWS Glue, si la práctica lo requiere y los permisos lo permiten.
- Ejecutar consultas para calcular temperatura media, máxima y mínima.
- Agrupar lecturas por dispositivo, fecha o estado.

**Conceptos:** Big Data, catálogo de datos, SQL analítico y consultas sobre datos en S3.

**Pendiente de verificar:** permisos de Athena/Glue, rol de ejecución, ubicación de resultados de consulta y consumo de presupuesto.

### Escenario 4. Control remoto del dispositivo mediante MQTT

**Objetivo:** convertir la estación de solo publicación en un dispositivo que también recibe instrucciones.

**Posibles actividades:**

- Mantener el programa Python conectado de forma continua.
- Suscribirse a un tema de comandos, por ejemplo `estacion-iot-wsl/commands`.
- Ampliar la política con `iot:Subscribe` sobre el ARN `topicfilter` correspondiente y `iot:Receive` sobre el ARN `topic` correspondiente.
- Enviar desde MQTT Test Client comandos para cambiar el intervalo de lectura, detener o reanudar la simulación y solicitar el estado.
- Publicar una respuesta/confirmación desde el dispositivo.

**Conceptos:** MQTT Publish/Subscribe, comunicación bidireccional, control remoto y mensajes de comando.

**Pendiente de implementar:** política de suscripción/recepción, aplicación Python persistente y manejo de comandos.

---

## 15. Instrucciones para continuar esta práctica en otro chat

Usar este documento como contexto técnico de la práctica IoT de AWS Learner Lab. Antes de proponer cambios:

1. Distinguir entre funcionalidades completadas y escenarios pendientes.
2. No volver a crear el Thing, el certificado ni la política si siguen existiendo y activos.
3. No sustituir el certificado X.509 por las credenciales temporales de AWS CLI: cumplen funciones diferentes.
4. No ampliar permisos sin justificar qué acción y recurso necesita la nueva etapa.
5. No modificar los recursos internos de AWS Academy.
6. Avanzar en etapas pequeñas y validar cada cambio en WSL y AWS Console.
7. Priorizar acciones visibles en AWS Console además de las pruebas por terminal.
8. No afirmar que una operación está permitida únicamente porque el servicio aparece en la lista de Learner Lab; verificar permisos y probar la operación concreta.
9. Considerar el presupuesto del laboratorio y limpiar únicamente los recursos propios cuando ya no se necesiten.

**Punto exacto de continuación:** la estación virtual `estacion-iot-wsl` publica cinco mensajes JSON por ejecución al tema `estacion-iot-wsl/telemetry`; MQTT Test Client los recibe correctamente. El siguiente escenario propuesto es IoT Rules para filtrar lecturas y generar alertas.

### Anexo A. `.gitignore` recomendado

Si el proyecto se versiona con Git, excluir los archivos locales y secretos:

```gitignore
.venv/
__pycache__/
*.py[cod]
certificados/*
!certificados/.gitkeep
```

No usar `git add -f` para forzar la inclusión de certificados o claves privadas.
