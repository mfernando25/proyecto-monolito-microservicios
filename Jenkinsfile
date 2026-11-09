pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Verificar Docker') {
            steps {
                sh 'docker version'
                sh 'docker compose version'
            }
        }

        stage('CI en paralelo') {
            parallel {

                stage('CI - Monolito') {
                    steps {
                        dir('monolito') {
                            sh 'docker compose up -d --build'
                            sh 'docker compose exec -T app npm test'
                        }
                    }
                    post {
                        failure {
                            dir('monolito') {
                                sh 'docker compose logs || true'
                            }
                        }
                        always {
                            dir('monolito') {
                                sh 'docker compose down -v || true'
                            }
                        }
                    }
                }

                stage('CI - Microservicios') {
                    steps {
                        dir('microservicios') {
                            sh 'docker compose up -d --build'

                            sh '''
                                for service in usuarios productos pedidos; do
                                    case "$service" in
                                        usuarios) port=3001 ;;
                                        productos) port=3002 ;;
                                        pedidos) port=3003 ;;
                                    esac

                                    ready=0

                                    for attempt in $(seq 1 30); do
                                        if docker compose exec -T "$service" node -e "const http=require('http'); const req=http.get('http://127.0.0.1:$port/health', r => {r.resume(); process.exit(r.statusCode >= 200 && r.statusCode < 300 ? 0 : 1)}); req.on('error', () => process.exit(1)); req.setTimeout(3000, () => {req.destroy(); process.exit(1)})"; then
                                            ready=1
                                            break
                                        fi
                                        sleep 2
                                    done

                                    if [ "$ready" -ne 1 ]; then
                                        echo "La API $service no responde en el puerto $port"
                                        exit 1
                                    fi

                                    echo "API $service disponible"
                                done
                            '''

                            sh 'docker compose exec -T usuarios npm test'
                            sh 'docker compose exec -T productos npm test'
                            sh 'docker compose exec -T pedidos npm test'
                        }
                    }
                    post {
                        failure {
                            dir('microservicios') {
                                sh 'docker compose logs || true'
                            }
                        }
                        always {
                            dir('microservicios') {
                                sh 'docker compose down -v || true'
                            }
                        }
                    }
                }
            }
        }
    }

    post {
        always {
            echo 'Pipeline finalizado.'
        }
    }
}
