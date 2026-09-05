export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface FetchTurnIceServersOptions {
  secretKey: string;
  baseUrl: string;
  expiryInSeconds?: number;
  fetchImpl?: typeof fetch;
}

interface CreateCredentialResponse {
  apiKey?: string;
}

// Duas chamadas server-to-server ao Metered: a 1ª cria uma credencial
// temporária (a secretKey nunca sai do backend); a 2ª troca o apiKey dessa
// credencial pela lista pronta de iceServers (STUN + variantes TURN
// udp/tcp/443) já com usuário e senha temporários embutidos. Qualquer falha
// (rede, credencial rejeitada, cota mensal do Metered esgotada) devolve uma
// lista vazia — nunca lança — para o chamador seguir só com STUN.
export async function fetchTurnIceServers(
  options: FetchTurnIceServersOptions
): Promise<IceServer[]> {
  const { secretKey, baseUrl, expiryInSeconds = 14400, fetchImpl = fetch } = options;
  try {
    const createResponse = await fetchImpl(
      `${baseUrl}/credential?secretKey=${encodeURIComponent(secretKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiryInSeconds })
      }
    );
    if (!createResponse.ok) {
      return [];
    }
    const created = (await createResponse.json()) as CreateCredentialResponse;
    if (!created.apiKey) {
      return [];
    }

    const listResponse = await fetchImpl(
      `${baseUrl}/credentials?apiKey=${encodeURIComponent(created.apiKey)}`
    );
    if (!listResponse.ok) {
      return [];
    }
    const iceServers = (await listResponse.json()) as unknown;
    return Array.isArray(iceServers) ? (iceServers as IceServer[]) : [];
  } catch {
    return [];
  }
}
