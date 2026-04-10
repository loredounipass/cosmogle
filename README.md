# cosmogle

cosmogle is a chill random video chat app where you can connect face-to-face with total strangers — no accounts, no drama, just hit “start” and vibe. It’s like Omegle, but self-built, using WebRTC and Socket.IO to handle real-time video, audio, and text chat smoothly.

The app is still in development and there’s plenty of room for improvement, but the core idea is already live. It’s an open project — anyone’s welcome to contribute!



Este proyecto utiliza las siguientes tecnologías:

## 🛠️ Tecnologías Stack

# Client
- ![JavaScript](https://img.shields.io/badge/JavaScript-323330?style=flat&logo=javascript&logoColor=F7DF1E) **JavaScript**
- ![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat&logo=node.js&logoColor=white) **Node.js**
- ![WebRTC](https://img.shields.io/badge/WebRTC-333333?style=flat&logo=webrtc&logoColor=white) **WebRTC**
- ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white) **Vite**
- ![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=flat&logo=socket.io&logoColor=white) **Socket.io** 
- ![REACT](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=white) **REACT**
- ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white) **TailwindCSS**

# Server
- ![Typescript](https://img.shields.io/badge/Typescript-323330?style=flat&logo=typescript&logoColor=F7DF1E) **Typescript**
- ![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat&logo=node.js&logoColor=white) **Node.js**
- ![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=flat&logo=socket.io&logoColor=white) **Socket.io**
- ![Express](https://img.shields.io/badge/Express.js-404D59?style=flat&logo=express&logoColor=white) **Express.js**
- ![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white) **Docker**
- ![Redis](https://img.shields.io/badge/Redis-DC382C?style=flat&logo=redis&logoColor=white) **Redis**



# logo
![cosmogle-logo](./client/assets/cosmogle.png)

# Arquitectura
![Arquitectura](./server/arquitectura/the_cosmogle_system_architecture_1.png)

# Conexion
![Conexion](./server//arquitectura/p2p_connection_flow_diagram_2.png)


## Configuración del entorno


## Clonar repositorio
```bash
$ git clone https://github.com/loredounipass/cosmogle
```

```bash
$ cd cosmogle
```

## Iniciar Frontend

```bash
$ cd client
$ pnpm install
$ pnpm run dev
```

## Iniciar Backend

```bash
$ cd server
$ pnpm install
$ pnpm run dev
```

## iniciar contenedores turn server y redis
```bash
$ docker-compose up -d
```

## Welcome page
![Welcome](./capturas/WELCOME.png)

## Inicio page
![Inicio](./capturas/INICIO.png)

## Video page
![Video](./capturas/VIDEO.png)
