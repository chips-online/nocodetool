/**
 * 一回限り: templates/supplement.mobile.json を生成（実行後このファイルは削除可）
 */
const fs = require("fs");
const path = require("path");
const outPath = path.join(__dirname, "..", "templates", "supplement.mobile.json");

/** スマホキャンバス幅（center テキストが画面外に出ないようセクション幅と一致させる） */
const MOBILE_W = 400;
/** ペア内の画像／テキスト列（左右余白を差し引いた幅） */
const MOBILE_INNER_W = 360;

function C(id, y, z, h, bg, children) {
  return {
    id,
    type: "container",
    x: 0,
    y,
    zIndex: z,
    style: {
      minWidth: MOBILE_W + "px",
      minHeight: "",
      width: MOBILE_W + "px",
      height: String(h) + "px",
      padding: "0px",
      borderRadius: "0px",
      minWidthPx: MOBILE_W,
      minHeightPx: 0,
      widthPx: MOBILE_W,
      heightPx: h,
      paddingPx: 0,
      backgroundColor: bg,
      backgroundAlphaPct: 100,
      borderRadiusPx: 0,
    },
    children,
  };
}

function card352(id, children) {
  return {
    id,
    type: "container",
    x: 0,
    y: 188,
    zIndex: 2,
    style: {
      minWidth: "352px",
      minHeight: "360px",
      width: "352px",
      height: "",
      padding: "0px",
      borderRadius: "0px",
      minWidthPx: 352,
      minHeightPx: 360,
      widthPx: 352,
      heightPx: 0,
      paddingPx: 0,
      backgroundColor: "",
      backgroundAlphaPct: 100,
      borderRadiusPx: 0,
    },
    children,
  };
}

function txt(text, y, fs, weight, color, w, align, extra) {
  const widthCss =
    typeof w === "string" && (w === "100%" || w.endsWith("%")) ? w : w + "px";
  return {
    type: "text",
    x: 0,
    y,
    zIndex: 2,
    text,
    style: Object.assign(
      {
        fontFamily: "sans-serif",
        fontSize: fs + "px",
        color,
        fontWeight: String(weight),
        width: widthCss,
        heightPx: 0,
        textAlign: align,
        lineHeight: 1.5,
      },
      extra || {}
    ),
  };
}

const data = [
  C("sup-hero", 0, 1, 1040, "#FCFEF9", [
    {
      id: "sup-hero-img",
      type: "image",
      x: 0,
      y: 0,
      zIndex: 1,
      src: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=1600&q=82",
      width: "100%",
      heightPx: 0,
    },
    txt("NATURAL INNER CARE", 500, 15, 700, "#81A76A", "100%", "center", {
      fontFamily: "sans-serif",
      letterSpacing: "0.22em",
      lineHeight: 1.4,
    }),
    txt("Glow From Within", 540, 40, 700, "#283B51", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.2,
    }),
    txt("内側から輝く、毎日のナチュラルケア。", 600, 28, 700, "#283B51", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.35,
    }),
    txt(
      "肌ケア・疲労対策・ボディメイクを1日2粒でサポート。20代後半〜40代女性の“なんとなく不調”に寄り添う美容健康サプリです。",
      668,
      17,
      400,
      "#283B51",
      "100%",
      "center",
      { lineHeight: 1.75 }
    ),
    {
      type: "button",
      x: 0,
      y: 820,
      zIndex: 3,
      label: "Try Now / 今すぐ試す",
      style: {
        fontFamily: "sans-serif",
        fontWeight: "700",
        fontSize: "17px",
        color: "#ffffff",
        backgroundColor: "#82CC00",
        backgroundColorSolid: "#82CC00",
        paddingVerticalPx: 14,
        paddingHorizontalPx: 24,
        borderRadiusPx: 999,
        borderWidthPx: 0,
        borderColor: "#283B51",
        backgroundImageSrc: "",
        backgroundImageFit: "cover",
        blockAlign: "center",
        width: "320px",
        heightPx: 56,
        lineHeight: 1.3,
      },
    },
  ]),
  C("sup-problem", 1040, 2, 920, "#EAF5D2", [
    txt("PROBLEM", 52, 16, 700, "#81A76A", "100%", "center", {
      letterSpacing: "0.2em",
      lineHeight: 1.4,
    }),
    txt("こんなお悩み、ありませんか？", 96, 32, 700, "#283B51", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.35,
    }),
    {
      id: "sup-prob-pair",
      type: "container",
      x: 0,
      y: 176,
      zIndex: 2,
      style: {
        minWidth: MOBILE_W + "px",
        minHeight: "400px",
        width: MOBILE_W + "px",
        height: "",
        padding: "0px",
        borderRadius: "0px",
        minWidthPx: MOBILE_W,
        minHeightPx: 400,
        widthPx: MOBILE_W,
        heightPx: 0,
        paddingPx: 0,
        backgroundColor: "",
        backgroundAlphaPct: 100,
        borderRadiusPx: 0,
      },
      children: [
        {
          id: "sup-prob-imgbox",
          type: "container",
          x: 0,
          y: 0,
          zIndex: 1,
          style: {
            minWidth: MOBILE_INNER_W + "px",
            minHeight: "330px",
            width: MOBILE_INNER_W + "px",
            height: "",
            padding: "0px",
            borderRadius: "0px",
            minWidthPx: MOBILE_INNER_W,
            minHeightPx: 330,
            widthPx: MOBILE_INNER_W,
            heightPx: 0,
            paddingPx: 0,
            backgroundColor: "",
            backgroundAlphaPct: 100,
            borderRadiusPx: 0,
          },
          children: [
            {
              type: "image",
              x: 0,
              y: 0,
              zIndex: 1,
              src: "https://images.pexels.com/photos/3812745/pexels-photo-3812745.jpeg",
              width: MOBILE_INNER_W + "px",
              height: "229px",
            },
          ],
        },
        {
          id: "sup-prob-txtbox",
          type: "container",
          x: 0,
          y: 0,
          zIndex: 1,
          style: {
            minWidth: MOBILE_INNER_W + "px",
            minHeight: "200px",
            width: MOBILE_INNER_W + "px",
            height: "",
            padding: "0px",
            borderRadius: "0px",
            minWidthPx: MOBILE_INNER_W,
            minHeightPx: 200,
            widthPx: MOBILE_INNER_W,
            heightPx: 0,
            paddingPx: 0,
            backgroundColor: "",
            backgroundAlphaPct: 100,
            borderRadiusPx: 0,
          },
          children: [
            txt(
              "・朝起きても疲れが抜けない\n・肌の乾燥やくすみが気になる\n・食事が乱れて栄養不足を感じる\n\n忙しい毎日ほど、体の内側のケアが後回しになりがちです。",
              0,
              18,
              400,
              "#283B51",
              "100%",
              "center",
              { lineHeight: 1.9 }
            ),
          ],
        },
      ],
    },
  ]),
  C("sup-solution", 1960, 3, 900, "#FCFEF9", [
    txt("SOLUTION", 52, 16, 700, "#81A76A", "100%", "center", {
      letterSpacing: "0.2em",
      lineHeight: 1.4,
    }),
    txt("不足しがちな栄養を、毎日手軽に補給", 96, 32, 700, "#283B51", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.35,
    }),
    {
      id: "sup-sol-pair",
      type: "container",
      x: 0,
      y: 176,
      zIndex: 2,
      style: {
        minWidth: MOBILE_W + "px",
        minHeight: "400px",
        width: MOBILE_W + "px",
        height: "",
        padding: "0px",
        borderRadius: "0px",
        minWidthPx: MOBILE_W,
        minHeightPx: 400,
        widthPx: MOBILE_W,
        heightPx: 0,
        paddingPx: 0,
        backgroundColor: "",
        backgroundAlphaPct: 100,
        borderRadiusPx: 0,
      },
      children: [
        {
          id: "sup-sol-txtbox",
          type: "container",
          x: 0,
          y: 0,
          zIndex: 2,
          style: {
            minWidth: MOBILE_INNER_W + "px",
            minHeight: "200px",
            width: MOBILE_INNER_W + "px",
            height: "",
            padding: "0px",
            borderRadius: "0px",
            minWidthPx: MOBILE_INNER_W,
            minHeightPx: 200,
            widthPx: MOBILE_INNER_W,
            heightPx: 0,
            paddingPx: 0,
            backgroundColor: "",
            backgroundAlphaPct: 100,
            borderRadiusPx: 0,
          },
          children: [
            txt(
              "ビタミン・ミネラル・コラーゲンをバランス配合。1日2粒で、肌・コンディション・代謝ケアをシンプルに続けられます。\n\n毎日続けるほど、肌のうるおい・朝の軽さ・前向きな気分を実感できます。",
              0,
              18,
              400,
              "#283B51",
              "100%",
              "center",
              { lineHeight: 1.85 }
            ),
          ],
        },
        {
          id: "sup-sol-imgbox",
          type: "container",
          x: 0,
          y: 0,
          zIndex: 1,
          style: {
            minWidth: MOBILE_INNER_W + "px",
            minHeight: "330px",
            width: MOBILE_INNER_W + "px",
            height: "",
            padding: "0px",
            borderRadius: "0px",
            minWidthPx: MOBILE_INNER_W,
            minHeightPx: 330,
            widthPx: MOBILE_INNER_W,
            heightPx: 0,
            paddingPx: 0,
            backgroundColor: "",
            backgroundAlphaPct: 100,
            borderRadiusPx: 0,
          },
          children: [
            {
              type: "image",
              x: 0,
              y: 0,
              zIndex: 1,
              src: "https://images.pexels.com/photos/9064740/pexels-photo-9064740.jpeg",
              width: MOBILE_INNER_W + "px",
              height: "229px",
            },
          ],
        },
      ],
    },
  ]),
  C("sup-feature", 2860, 4, 1680, "#EAF5D2", [
    txt("FEATURE", 52, 16, 700, "#81A76A", "100%", "center", {
      letterSpacing: "0.2em",
      lineHeight: 1.4,
    }),
    txt("選ばれる3つの特徴", 96, 32, 700, "#283B51", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.35,
    }),
    card352("sup-feat-a", [
      {
        type: "image",
        x: 0,
        y: 0,
        zIndex: 1,
        src: "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=82",
        width: "352px",
        height: "220px",
      },
      txt("成分設計", 236, 28, 700, "#283B51", 352, "center", {
        fontFamily: "serif",
        lineHeight: 1.35,
      }),
      txt(
        "ビタミンC・B群、コラーゲン、乳酸菌を配合し、毎日の美容と健康を多角的に支えます。",
        288,
        16,
        400,
        "#283B51",
        352,
        "center",
        { lineHeight: 1.7 }
      ),
    ]),
    card352("sup-feat-b", [
      {
        type: "image",
        x: 0,
        y: 0,
        zIndex: 1,
        src: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?auto=format&fit=crop&w=900&q=82",
        width: "352px",
        height: "220px",
      },
      txt("安全性", 236, 28, 700, "#283B51", 352, "center", {
        fontFamily: "serif",
        lineHeight: 1.35,
      }),
      txt(
        "国内GMP準拠工場で製造。不要な添加物を抑え、毎日安心して続けられる品質です。",
        288,
        16,
        400,
        "#283B51",
        352,
        "center",
        { lineHeight: 1.7 }
      ),
    ]),
    card352("sup-feat-c", [
      {
        type: "image",
        x: 0,
        y: 0,
        zIndex: 1,
        src: "https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=900&q=82",
        width: "352px",
        height: "220px",
      },
      txt("継続しやすさ", 236, 28, 700, "#283B51", 352, "center", {
        fontFamily: "serif",
        lineHeight: 1.35,
      }),
      txt(
        "1日2粒のシンプル設計。忙しい朝や外出先でも、水と一緒に手軽に摂取できます。",
        288,
        16,
        400,
        "#283B51",
        352,
        "center",
        { lineHeight: 1.7 }
      ),
    ]),
  ]),
  C("sup-benefit", 4540, 5, 480, "#FCFEF9", [
    txt("BENEFIT", 52, 16, 700, "#81A76A", "100%", "center", {
      letterSpacing: "0.2em",
      lineHeight: 1.4,
    }),
    txt("変化を実感できる毎日へ", 96, 32, 700, "#283B51", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.35,
    }),
    txt(
      "朝の目覚めが軽くなり、日中の集中力が続く。\n肌のうるおいとハリを感じ、鏡を見る時間が前向きになる。\n“なんとなく不調”から抜け出し、自信を持てるコンディションへ。",
      176,
      19,
      400,
      "#283B51",
      "100%",
      "center",
      { lineHeight: 1.9 }
    ),
  ]),
  C("sup-lifestyle", 5020, 6, 900, "#EAF5D2", [
    txt("LIFESTYLE", 52, 16, 700, "#81A76A", "100%", "center", {
      letterSpacing: "0.2em",
      lineHeight: 1.4,
    }),
    txt("日常の変化", 96, 32, 700, "#283B51", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.35,
    }),
    card352("sup-life-a", [
      {
        type: "image",
        x: 0,
        y: 0,
        zIndex: 1,
        src: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=82",
        width: "352px",
        height: "240px",
      },
      txt("生活の質の向上", 252, 24, 700, "#283B51", 352, "center", {
        fontFamily: "serif",
        lineHeight: 1.4,
      }),
    ]),
    card352("sup-life-b", [
      {
        type: "image",
        x: 0,
        y: 0,
        zIndex: 1,
        src: "https://images.pexels.com/photos/8990463/pexels-photo-8990463.jpeg",
        width: "352px",
        height: "240px",
      },
      txt("肌質の改善", 252, 24, 700, "#283B51", 352, "center", {
        fontFamily: "serif",
        lineHeight: 1.4,
      }),
    ]),
    card352("sup-life-c", [
      {
        type: "image",
        x: 0,
        y: 0,
        zIndex: 1,
        src: "https://images.pexels.com/photos/6941126/pexels-photo-6941126.jpeg",
        width: "352px",
        height: "240px",
      },
      txt("睡眠の質の向上", 252, 24, 700, "#283B51", 352, "center", {
        fontFamily: "serif",
        lineHeight: 1.4,
      }),
    ]),
  ]),
  C("sup-review", 5920, 7, 560, "#FCFEF9", [
    txt("REVIEW", 52, 16, 700, "#81A76A", "100%", "center", {
      letterSpacing: "0.2em",
      lineHeight: 1.4,
    }),
    txt("お客様の声", 96, 32, 700, "#283B51", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.35,
    }),
    txt(
      "「2週間ほどで朝のだるさが軽くなりました。仕事の日も気持ちよくスタートできます。」\n— 34歳 / 会社員",
      176,
      17,
      400,
      "#283B51",
      "100%",
      "center",
      { lineHeight: 1.8 }
    ),
    txt(
      "「乾燥しやすい季節でも肌の調子が安定。ファンデのノリが変わって驚きました。」\n— 29歳 / 事務職",
      300,
      17,
      400,
      "#283B51",
      "100%",
      "center",
      { lineHeight: 1.8 }
    ),
    txt(
      "「小粒で飲みやすく、無理なく続けられるのが嬉しい。体調管理の定番になりました。」\n— 41歳 / パート",
      424,
      17,
      400,
      "#283B51",
      "100%",
      "center",
      { lineHeight: 1.8 }
    ),
  ]),
  C("sup-cta", 6480, 8, 440, "#283B51", [
    txt("LIMITED OFFER", 52, 16, 700, "#EAF5D2", "100%", "center", {
      letterSpacing: "0.24em",
      lineHeight: 1.4,
    }),
    txt("まずは30日、内側からの変化を体感してください。", 96, 30, 700, "#FCFEF9", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.35,
    }),
    {
      type: "button",
      x: 0,
      y: 220,
      zIndex: 3,
      label: "Start Now / 今すぐ始める",
      style: {
        fontFamily: "sans-serif",
        fontWeight: "700",
        fontSize: "17px",
        color: "#ffffff",
        backgroundColor: "#82CC00",
        backgroundColorSolid: "#82CC00",
        paddingVerticalPx: 14,
        paddingHorizontalPx: 24,
        borderRadiusPx: 999,
        borderWidthPx: 0,
        borderColor: "#81A76A",
        backgroundImageSrc: "",
        backgroundImageFit: "cover",
        blockAlign: "center",
        width: "360px",
        heightPx: 56,
        lineHeight: 1.3,
      },
    },
  ]),
  C("sup-foot", 6920, 9, 200, "#283B51", [
    txt("Natural Inner Care Supplement", 48, 22, 700, "#FCFEF9", "100%", "center", {
      fontFamily: "serif",
      lineHeight: 1.3,
    }),
    txt(
      "特定商取引法に基づく表記 / プライバシーポリシー / お問い合わせ",
      96,
      14,
      400,
      "#EAF5D2",
      "100%",
      "center",
      { lineHeight: 1.6 }
    ),
  ]),
];

const doc = {
  name: "サプリメント販売LP",
  canvas: {
    widthPx: 400,
    floorHeightPx: 400,
    backgroundColor: "#FCFEF9",
    backgroundImageSrc: "",
    backgroundImageFit: "cover",
  },
  data,
};

fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log("Wrote", outPath, "blocks", data.length);
