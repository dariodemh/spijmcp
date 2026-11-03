/**
 * Configuración de la extensión: versión y repositorio de GitHub.
 *
 * Para publicar tu propia copia cambia REPO_POR_DEFECTO por tu usuario/repo
 * (por ejemplo "anaperez/spij-mcp") o define la variable SPIJ_MCP_REPO.
 */

const ENV = (typeof process !== "undefined" && process.env) || {};

export const VERSION = "0.2.0";

/** Repositorio usado para comprobar actualizaciones. */
export const REPO_POR_DEFECTO = "dariodemh/spijmcp";

export const REPO = ENV.SPIJ_MCP_REPO || REPO_POR_DEFECTO;

/** ¿El valor parece un repositorio real de GitHub ("usuario/repo")? */
export function esRepoConfigurado(repo = REPO) {
  const valor = String(repo || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(valor)) return false;
  return !/^TU-USUARIO\//i.test(valor);
}

/** Devuelve el repositorio configurado o cadena vacía. */
export function resolverRepo(repo) {
  const valor = String(repo || "").trim();
  if (valor) return valor;
  return esRepoConfigurado(REPO) ? REPO : "";
}
