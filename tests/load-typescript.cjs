'use strict';

// Instalar TypeScript localmente o definir TYPESCRIPT_PATH hacia una instalación existente.
// No busca ni modifica repositorios históricos y no descarga dependencias.
module.exports = require(process.env.TYPESCRIPT_PATH || 'typescript');
