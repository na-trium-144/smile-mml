// ドキュメント内の参照中マクロ名を保持
let referencedMacros = new Set();

// --- 1. ドキュメント内から参照されているマクロ名を抽出する処理 ---
window.mmlHightlightRules_UpdateReferencedMacros = function (docText) {
  referencedMacros = new Set();
  // {マクロ名} (= を含まない参照パターン) を抽出
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  let match;
  while ((match = regex.exec(docText)) !== null) {
    referencedMacros.add(match[1]);
  }
};

// --- 2. Ace Editor の MML ハイライタールールを定義 ---
ace.define(
  "ace/mode/mml_highlight_rules",
  [
    "require",
    "exports",
    "module",
    "ace/lib/oop",
    "ace/mode/text_highlight_rules",
  ],
  function (require, exports, module) {
    const oop = require("ace/lib/oop");
    const TextHighlightRules =
      require("ace/mode/text_highlight_rules").TextHighlightRules;

    const MMLHighlightRules = function () {
      // 基本となる MML 構成要素のルール群
      const mmlRules = [
        // 1. コメント (/コメント/)
        {
          token: "sb3_comment",
          regex: "/",
          next: "mml_comment",
        },

        // 2. マクロ定義 ({マクロ名=MML})
        {
          regex: /\{([a-zA-Z0-9_]+)=/,
          onMatch: function (value, currentState, stack) {
            const macroName = value.substring(1, value.length - 1);
            // 参照されているマクロなら MML としてハイライト、未参照なら全体コメント化
            if (referencedMacros.has(macroName)) {
              this.next = "macro_mml";
              return "sb3_keyword";
            } else {
              this.next = "macro_comment";
              return "sb3_comment";
            }
          },
        },
        // マクロ参照 ({マクロ名})
        {
          token: "sb3_keyword",
          regex: /\{[a-zA-Z0-9_]+\}/,
        },

        // 3. 変数 ($0=123 の定義 と $0 の参照)
        {
          token: ["sb3_keyword", "sb3_numeric"],
          regex: "(\\$[0-7]=)(\\d+)",
        },
        {
          token: "sb3_keyword",
          regex: "\\$[0-7]",
        },

        // 4. チャンネル指定 (:0 〜 :15)
        {
          token: "sb3_keyword",
          regex: ":(?:1[0-5]|\\d)",
        },

        // 5. テンポ指定 (T1 〜 T512)
        {
          token: "sb3_keyword",
          regex: "[tT]\\d+",
        },

        // 6. ループ ([ と ]回数)
        {
          token: "sb3_keyword",
          regex: "\\[|\\]\\d*",
        },

        // 7. statement (@V音量, @Dデチューン は label 判定より先に評価)
        {
          token: "sb3_statement",
          regex: "@[vV]\\d+|@[dD]-?\\d+",
        },

        // 8. label (音色, トレモロ, ビブラート, オートパン, モジュレーション, エンベロープ)
        {
          token: "sb3_label",
          regex: "@[mM][oO][fF]|@[mM][oO][nN]|@[eE][rR]",
        },
        {
          token: "sb3_label",
          regex:
            "@[mM][aA](?:\\d+,){3}\\d+|@[mM][pP](?:\\d+,){3}\\d+|@[mM][lL](?:\\d+,){3}\\d+|@[eE](?:\\d+,){3}\\d+",
        },
        {
          token: "sb3_label",
          regex: "@\\d+", // 音色 @0〜@511
        },

        // 9. その他の statement (デフォルト音長, ゲート, ベロシティ, パン, オクターブ)
        // 音長は numeric (半音記号・数値・付点)
        {
          token: ["sb3_statement", "sb3_numeric"],
          regex: "([lL])([\\.\\d]*)",
        },
        {
          token: "sb3_statement",
          regex: "[qQ]\\d+|[pP]\\d+|[oO]\\d+|[vV]\\d+|[<>]|!",
        },
        {
          token: "sb3_statement",
          regex: "\\(\\d*|\\)\\d*", // ベロシティ相対変更 (, (10, ), )10
        },

        // 10. string (休符 R、タイ &、ポルタメント _)
        {
          token: "sb3_string",
          regex: "[rR][#+\\-\\.\\d]*",
        },

        // 11. text (音程 CDEFGAB) & numeric (半音記号・数値・付点)
        {
          token: ["sb3_text", "sb3_text", "sb3_numeric", "sb3_text", "sb3_string"],
          regex: "([cdefgabCDEFGAB])([#+\\-]*)([\\.\\d]*)([#+\\-]*)([&_]?)",
        },

        // 12. unknown (上記いずれにも当てはまらない不正な文字)
        {
          defaultToken: "sb3_unknown",
        },
      ];

      this.$rules = {
        start: mmlRules,

        // /コメント/ 内のステート
        mml_comment: [
          { token: "sb3_comment", regex: "/", next: "start" },
          { defaultToken: "sb3_comment" },
        ],

        // 使用中のマクロ展開内のステート (通常の MML ルールを適用)
        macro_mml: [
          { token: "sb3_keyword", regex: "\\}", next: "start" },
        ].concat(mmlRules),

        // 未使用マクロ内のステート (全体をコメント化)
        macro_comment: [
          { token: "sb3_comment", regex: "\\}", next: "start" },
          { defaultToken: "sb3_comment" },
        ],
      };
    };

    oop.inherits(MMLHighlightRules, TextHighlightRules);
    exports.MMLHighlightRules = MMLHighlightRules;
  },
);

// --- 3. MML モードの作成 ---
ace.define(
  "ace/mode/mml",
  [
    "require",
    "exports",
    "module",
    "ace/lib/oop",
    "ace/mode/text",
    "ace/mode/mml_highlight_rules",
  ],
  function (require, exports, module) {
    const oop = require("ace/lib/oop");
    const TextMode = require("ace/mode/text").Mode;
    const MMLHighlightRules =
      require("ace/mode/mml_highlight_rules").MMLHighlightRules;

    const Mode = function () {
      this.HighlightRules = MMLHighlightRules;
    };
    oop.inherits(Mode, TextMode);

    (function () {
      this.$id = "ace/mode/mml";
    }).call(Mode.prototype);

    exports.Mode = Mode;
  },
);
