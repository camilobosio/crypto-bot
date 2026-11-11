# crypto-bot: futuros perpetuos (Bybit)

Bot de trading intradía de futuros perpetuos USDT con apalancamiento, sobre 8 pares de Bybit.
**Hoy opera solo en simulación (paper trading) con precios reales.** No tiene conexión a tu cuenta.

Requiere Node 20.11 o superior. No tiene dependencias externas.

**📊 Cómo va la prueba: [state/RESUMEN.md](state/RESUMEN.md)** (se actualiza cada 15 minutos desde GitHub Actions).

## Comandos

```bash
npm run data                         # baja 12 meses de velas de 5m y tasas de financiamiento de Bybit
npm run backtest -- mtfPullback      # backtest con parámetros fijos (optimista)
npm run walkforward -- mtfPullback   # LA prueba que cuenta: meses que el optimizador no vio
node scripts/test-lookahead.js       # verifica que el motor no use datos del futuro
npm run paper                        # paper trading 24/7 (revisa cada minuto)
node scripts/paper.js --reset        # empieza la simulación de cero
```

Reportes HTML en `reports/`. Estado, log, operaciones y `RESUMEN.md` del paper trading en `state/`.

## Cómo decide

Todas las temporalidades se arman a partir de las velas de 5m, y el bot solo ve velas mayores **ya cerradas**.

| Temporalidad | Rol |
|---|---|
| Diario | Filtro opcional: precio arriba (largos) o abajo (cortos) de la EMA20. |
| 4 h | Dirección: EMA21 vs. EMA55. Solo opera a favor. Si la tendencia gira, cierra. |
| 1 h | `mtfPullback`: el precio retrocede a la EMA21 y la recupera. `mtfBreakout`: rompe el máximo/mínimo de las últimas 12-24 h. |
| 15 m | Confirma el impulso (precio vs. EMA9) y da el ATR para el stop. |
| 5 m | Gatillo: ruptura del máximo/mínimo reciente. Entra a la apertura de la vela siguiente. |

Cada operación tiene stop, objetivo en múltiplos del riesgo (R) y cierre por tiempo a las 24 h.
Opcionalmente pasa el stop a break-even o lo va acercando.

## Apalancamiento: lo elige el bot en cada operación

1. Arriesga un % fijo del patrimonio hasta el stop (`riskPerTradePct`, hoy 5 %). Con eso sale el tamaño.
2. Elige el **mayor apalancamiento que deja la liquidación al menos 2 veces más lejos que el stop**, con techo de 20x.
   Stop cerca → más apalancamiento. Stop lejos → menos.
3. Margen aislado. Máximo 3 posiciones a la vez, cada una con hasta un tercio del capital como margen.

## Riesgo (config.js)

| Regla | Valor |
|---|---|
| Riesgo por operación | 5 % del patrimonio |
| Interruptor | caída del 40 % desde el máximo: cierra todo y se detiene hasta `--unhalt` |
| Límite diario | **desactivado** para la prueba (después: `dailyLossPct: 0.5`) |
| Costos simulados | comisión 0,055 % taker / 0,02 % maker, slippage 0,03 %, financiamiento real de Bybit |

## Resultados al 11/11/2026 (12 meses de datos de Bybit, 8 pares)

| Prueba | mtfBreakout | mtfPullback |
|---|---|---|
| Ventaja por operación **sin costos** | **+0,14 R** | +0,01 R |
| Ventaja con costos reales (órdenes a mercado) | −0,01 R | −0,09 R |
| Ventaja si entra y sale con órdenes límite (maker) | +0,10 R | −0,05 R |
| Walk-forward fuera de muestra (abr → nov 2026) | interruptor a las 2 semanas (−32 %) | interruptor al mes |

**Conclusión honesta:** todavía **no hay ventaja neta**. `mtfBreakout` detecta algo real, pero las comisiones de órdenes a mercado se lo comen.
Con 5 % de riesgo por operación y una ventaja cercana a cero, el interruptor del 40 % salta en semanas.
`mtfPullback` queda descartada.

## Próximas mejoras (en orden)

1. **Entradas con órdenes límite (maker)** en lugar de a mercado: es la diferencia entre −0,01 R y +0,10 R.
2. **Riesgo correlacionado:** en la prueba de 3 días entró en corto en BTC, DOGE y SUI a la vez y los 3 tocaron stop juntos. Es una sola apuesta repetida.
   Hay que limitar el riesgo total abierto en la misma dirección.
3. Menos operaciones y de más calidad: filtro de volatilidad y de horario.
4. Recién con ventaja neta positiva en walk-forward: paper trading continuo y después dinero real en Bybit.

## Dónde correrlo

El paper trading revisa cada minuto, así que necesita una máquina prendida.
Para no usar tu compu: un servidor chico (VPS) **fuera de EE. UU.**, porque Bybit bloquea esas IP. Cuesta unos 4-5 USD por mes y es el mismo que después serviría para operar en real.
