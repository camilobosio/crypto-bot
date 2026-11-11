// Configuración central del bot de FUTUROS PERPETUOS (Bybit, USDT lineales).
// Todo límite de riesgo vive acá y lo aplica src/engine.js. Ninguna estrategia lo puede saltear.
export default {
  exchange: 'bybit',
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'LINKUSDT', 'SUIUSDT'],
  historyDays: 365,           // histórico de velas de 5m para backtest
  initialCapital: 100,        // USDT simulados

  costs: {
    takerFee: 0.00055,        // Bybit perpetuos, nivel VIP 0: 0,055 % (órdenes a mercado y stops)
    makerFee: 0.0002,         // 0,02 % (take profit como orden límite)
    slippagePct: 0.0003,      // 0,03 % por lado en entradas y stops
    defaultFunding: 0.0001,   // si falta el dato real de financiamiento (cada 8 h)
  },

  risk: {
    riskPerTradePct: 0.05,    // cada operación arriesga 5 % del patrimonio entre entrada y stop
    maxPositions: 3,          // posiciones abiertas a la vez
    maxLeverage: 20,          // techo; el bot elige el apalancamiento por operación
    maintMarginPct: 0.005,    // margen de mantenimiento aproximado (Bybit, montos chicos)
    liqSafety: 2,             // la liquidación tiene que quedar al menos 2x más lejos que el stop
    minStopPct: 0.006,        // stops más cortos que 0,6 % se descartan: ida y vuelta cuesta ~0,14 %,
                              // con stops más cortos las comisiones se comen buena parte de cada operación
    maxDrawdownPct: 0.40,     // interruptor: si cae 40 % desde el máximo, cierra todo y se detiene
    dailyLossPct: null,       // desactivado en la prueba. Después: 0.5 => si pierde 50 % en el día, para hasta mañana
    cooldownMin: 60,          // tras cerrar en un par, espera 1 h antes de volver a entrar ahí
  },

  strategy: 'mtfBreakout',    // 'mtfBreakout' o 'mtfPullback' (ver src/strategies.js)

  walkforward: {
    warmupDays: 60,
    trainMonths: 3,
    testMonths: 1,
    minTrades: 20,
    minTrainSharpe: 0,        // si nada fue rentable en el entrenamiento, ese mes no opera
  },
};
