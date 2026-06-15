const { chromium } = require("playwright");
const path = require("path");
const serveStatic = require("serve-static");
const finalhandler = require("finalhandler");
const http = require("http");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PORT = 8099;

const PHRASES = [
  "No está mal querer salir con un man estable económicamente, pero esas que solo hablan de plata es porque fueron unas muertas de hambre.",
  "No viniste a este mundo solo para sobrevivir. Mereces momentos de alegría, paz y días que no pesen tanto. Mereces mirarte con ternura, tratarte con paciencia y confiar en que eres capaz de alcanzar todo lo que anhelas.",
  "No tengo tiempo para gente falsa",
  "Opérense...aborten",
  "Opérense...se enamoren.",
  "Opérense...de nadie",
  "Hola",
  "Hola mundo",
  "Buenos dias",
  "Vivir la vida sin miedo",
  "Creen que me voy a quedar callada pero toda la vida me han reganado por contestona",
  "El amor propio no se negocia con nadie",
  "anticonstitucionalisimisisisisisisisimamente",
  "A lo mejor no encuentras el amor porque eres el problema y Dios está cuidando a las otras personas de ti.",
  "Opérense, llénense todo de ácido hialurónico, sean bien putas e interesadas, aborten y nunca se enamoren.",
  "Ya no quiero conocer a nadie. Los que estamos, estamos.",
  "No hay rastro de lo que yo era en el 2016, ni parezco yo.",
  "La clave de una relación es callarte y hacerle caso a tu mujer.",
  "A mí no me pidan consejos de relaciones porque para mí todo se soluciona yéndose.",
  "Construí muros tan altos que ya nadie puede entrar, pero yo tampoco puedo salir.",
  "Relajada, porque la dueña de la piñata nunca pelea por los dulces.",
  "Nomás en tu mente somos enemigas, en la mía eres una pendeja.",
  "Últimamente estoy dejando que todo fluya. Si se da, bien; y si no, no pasa nada. No me pienso estresar por nada ni nadie.",
  "Hola luna, vine a llorarte sobre amor otra vez.",
  "He fumado más de lo que he follado.",
  "Uno parece que tuviera el don de enamorarse de la persona más remalparida.",
  "Anhelaría estar en ese universo paralelo en el que todavía me quieres.",
  "No me duele el pasado, me pesa haber entendido tan tarde algunas cosas.",
  "Disfruten la soltería, hay gente pidiendo perdón por echarse un sueñito sin avisar.",
  "Al final él ganó, porque ya no volveré a molestarlo, ni a insistirle, ni a querer arreglar nada. Es lo que él quería y al fin lo entendí.",
  "El diablo no logró alcanzarme, entonces hizo que me enamorara de alguien que nunca se fijaría en mí.",
  "Entro a Plato después de un tiempo y veo todos los chats con mis amores fallidos.",
  "¿De qué sirve todo ese amor que alardeas si te da miedo entregarlo?",
  "Dizque \"hombre performativo\". Mano, usted es bobo y ya.",
  "Hay hombres que piensan que su vida va a mejorar si su espalda se vuelve más ancha.",
  "Tu novio, el puto que sube dump del mes.",
  "Objetivo 2026: volver a relacionarme con tipos. Obstáculo: los tipos.",
  "El perro siempre vuelve con la dueña, por más bien que lo trate la vecina.",
  "Decirle a un man que no la vaya a cagar es como retarlo.",
  "Ay, qué... estos hombres de hoy en día. Y después que por qué nos volvemos tan pirobitas.",
  "Me divierte tanto mentir por deporte. En otra vida fui un tipo.",
  "Es importante cerrar la jeta cuando uno es ignorante en un tema o no aporta en nada.",
  "¿Cómo que Met Gala, socio? Póngase a desbaratar una moto, aprenda a robar, vaya tire mezcla o azadón.",
  "Pedir o no pedir un vapo por Rappi.",
  "Entre los estudiantes de medicina, los gymrats, los runners y los seguidores de ya sabemos quien, no sé quienes son más insoportables!",
  "Yo lo definiría como: creando contenido para mi psicóloga.",
  "Hay gente que no ha tenido paranoia de que la vigilan y se nota.",
  "Yo creo que solo un beso de \"Usuario desconocido\" me quita esta pensadera tan hp.",
  "Hagan un vape de ibuprofeno, que me duele la cabeza.",
  "Chao, me habla cuando se quiera casar y nos vemos en la notaría.",
  "Uno enojado puede llegar a cualquier lado caminando.",
  "Detrás del cringe se encuentra la vida que quieres.",
  "Unas ganas de arrancar pa' la puta mierda.",
  "Ojalá cancelen esas fiestas de techno que todo el mundo va a soplar y beber, no como las de vallenato que todo el mundo va a soplar y beber, o las de reguetón que todo el mundo va a soplar y beber, o las buenas fiestas de corridos que todo el mundo va soplar y beber"
];

function startServer() {
  return new Promise((resolve) => {
    const serve = serveStatic(ROOT_DIR, { index: ["index.html"] });
    const server = http.createServer((req, res) => serve(req, res, finalhandler(req, res)));
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const server = await startServer();
  const url = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });

  await page.goto(`${url}/?text=x&mode=retro3d&bg=%230a1628`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.renderReady === true, { timeout: 30000 });

  let overflowCount = 0, jumpCount = 0, outlierCount = 0;

  for (const text of PHRASES) {
    const info = await page.evaluate((t) => getRetro3DLayoutDebug(t), text);

    const overflow = info.lines.some(l => l.fillRatio > 1);
    const outliers = info.lines.filter(l => l.fillRatio < 0.98);
    const fontSizes = info.lines.map(l => l.fontSize);
    const jumps = [];
    for (let i = 0; i < fontSizes.length - 1; i++) {
      const a = fontSizes[i], b = fontSizes[i + 1];
      const ratio = Math.max(a, b) / Math.min(a, b);
      if (ratio > 1.8) jumps.push(+ratio.toFixed(2));
    }

    if (overflow) { overflowCount++; console.log('OVERFLOW:', text.slice(0,50), info.lines.map(l=>+l.fillRatio.toFixed(3))); }
    if (jumps.length) { jumpCount++; console.log('JUMP:', text.slice(0,50), jumps, fontSizes); }
    if (outliers.length) { outlierCount++; console.log('OUTLIER:', text.slice(0,50), outliers.map(l => ({ text: l.text, fillRatio: +l.fillRatio.toFixed(3) }))); }
  }

  console.log(`\ntotal ${PHRASES.length} overflow ${overflowCount} jumps ${jumpCount} outliers ${outlierCount}`);

  await browser.close();
  server.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
