// Mesa de memecoins de Solana — PAPER TRADING (dinero simulado).
// Prioridad: proteger el capital. Todos los límites viven acá y los aplica el código, no un modelo.
export default {
  capitalUsd: 100,
  // Cambiar este nombre reinicia el paper de cero (la sesión anterior queda archivada en la rama de datos).
  sessionId: '2026-11-12-v2',

  scout: {
    pumpportal: true,           // tokens nuevos y migraciones de Pump.fun en vivo (websocket)
    geckoEverySec: 60,          // pools nuevos de Raydium y demás DEX (GeckoTerminal)
    dexProfilesEverySec: 60,    // tokens recién perfilados/boosteados en DexScreener
    watchMinutes: 45,           // cuánto tiempo se sigue a un candidato esperando que cumpla volumen
    maxWatch: 3000,
  },

  filter: {
    minVolumeH1Usd: 50_000,     // volumen de la última hora
    maxTop10Pct: 20,            // top 10 holders (sin contar pools/curva) <= 20 %
    minLpLockedPct: 90,         // LP bloqueado o quemado
    minLiquidityUsd: 50_000,    // liquidez mínima del pool: menos que esto se vacía con pocas ventas
    maxInsiders: 20,            // wallets insider detectadas por RugCheck (los rugs de anoche tenían +4.000)
    maxChange5mPct: 30,         // no entra si subió más de 30 % en 5 min (perseguir velas verticales)
    maxChainGapPct: 0.15,       // si blockchain y DexScreener difieren > 15 %, los datos no son confiables
    requireMintRevoked: true,
    requireFreezeRevoked: true, // extra de seguridad: con freeze activo el dev puede congelar tu saldo
    rugcheckEverySec: 2.5,      // ritmo de consultas a RugCheck
    recheckMinutes: 30,         // un token que falló seguridad se puede reevaluar pasado este tiempo
  },

  analyst: { minScore: 0.6 },

  executor: {
    maxPctPerTrade: 0.08,       // 8 % del saldo actual por operación. Nunca más.
    maxOpen: 5,
    costPct: 0.01,              // comisión + slippage estimados por lado (1 %)
    lossStreakPause: 3,         // anti-venganza: tras 3 pérdidas seguidas, pausa
    pauseMinutes: 30,
  },

  risk: {
    stopPct: -0.06,             // stop fijo
    trailActivatePct: 0.12,     // el trailing solo se activa en ganadoras desde +12 %
    trailDistancePct: 0.06,     // y sigue al máximo a 6 % de distancia
    takeProfitPct: 0.25,        // en +25 % vende una parte...
    takeProfitFraction: 0.5,    // ...la mitad
    breakEvenFactor: 1.025,     // y el stop del resto pasa a la entrada (+2,5 % para cubrir comisiones)
    rugLiquidityDrop: 0.5,      // si la liquidez cae 50 % desde la entrada, sale ya (posible rug)
    checkEverySec: 2,           // precio de la blockchain cada 2 s (PumpSwap)
    dexEverySec: 10,            // DexScreener cada 10 s (otros pools y precio del SOL)
  },

  accountKillSwitchPct: null,   // DESACTIVADO en la prueba: el bot sigue aunque la cuenta caiga
  summaryHourUtc: 12,           // resumen diario a las 9:00 de Argentina
};
