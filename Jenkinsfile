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
                sh 'rm -rf reports && mkdir -p reports'
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

                            sh 'docker compose exec -T app sh -c "JEST_JUNIT_OUTPUT_FILE=/app/junit.xml npm test -- --reporters=default --reporters=jest-junit"'
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
                                sh 'docker compose cp app:/app/junit.xml ../reports/monolito.xml || true'
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
                                        echo "La API $service no responde"
                                        exit 1
                                    fi
                                done
                            '''

                            sh 'docker compose exec -T usuarios sh -c "JEST_JUNIT_OUTPUT_FILE=/app/junit.xml npm test -- --reporters=default --reporters=jest-junit"'

                            sh 'docker compose exec -T productos sh -c "JEST_JUNIT_OUTPUT_FILE=/app/junit.xml npm test -- --reporters=default --reporters=jest-junit"'

                            sh 'docker compose exec -T pedidos sh -c "JEST_JUNIT_OUTPUT_FILE=/app/junit.xml npm test -- --reporters=default --reporters=jest-junit"'
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
                                sh 'docker compose cp usuarios:/app/junit.xml ../reports/usuarios.xml || true'
                                sh 'docker compose cp productos:/app/junit.xml ../reports/productos.xml || true'
                                sh 'docker compose cp pedidos:/app/junit.xml ../reports/pedidos.xml || true'
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
            junit testResults: 'reports/**/*.xml', allowEmptyResults: true
            echo 'Pipeline finalizado.'
        }
    }
}
