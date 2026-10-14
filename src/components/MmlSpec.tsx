import { Fragment } from "react/jsx-runtime";

export function MmlSpec() {
  return (
    <div className="mml-spec">
      {/*SmileBASIC2と4では一部若干異なる仕様があり、vmmlParserにはK、歌唱、和音、コメントなど4特有のコマンドも一部実装されているが、現時点では再生部分は3互換の仕様を優先して実装する。*/}
      <h4>全体の制御コマンド</h4>
      <ul>
        <li>
          チャンネル <span className="text-sb3-keyword">:0</span> 〜{" "}
          <span className="text-sb3-keyword">:15</span>
        </li>
        <li>
          テンポ <span className="text-sb3-keyword">T1</span> 〜{" "}
          <span className="text-sb3-keyword">T512</span>
        </li>
        <li>
          ループ <span className="text-sb3-keyword">[</span> 〜{" "}
          <span className="text-sb3-keyword">
            ]<var>回数</var>
          </span>
          <ul>
            <li>
              <var>回数</var> 0または省略時は無限ループ
            </li>
            {/*- (非公式情報) `O`,`L`,`Q`,`V`の4パラメータ (+SmileBASIC4では `K` も) のみ、ループ開始の瞬間の値に復元される。 http://petitverse.hosiken.jp/community/petitcom/topic/?read=1474&ukey=0*/}
          </ul>
        </li>
        <li>
          マクロの定義{" "}
          <span className="text-sb3-keyword">
            {"{"}
            <var>ラベル名</var>=
            <span className="text-sb3-text">
              <var>MML文字列</var>
            </span>
            {"}"}
          </span>
        </li>
        <li>
          マクロの展開{" "}
          <span className="text-sb3-keyword">
            {"{"}
            <var>ラベル名</var>
            {"}"}
          </span>
        </li>
      </ul>
      <h4>音符</h4>
      <ul>
        <li>
          音程{" "}
          {Array.from("CDEFGAB").map((c, i) => (
            <Fragment key={c}>
              {i > 0 && ", "}
              <span className="text-sb3-text">{c}</span>
            </Fragment>
          ))}
          <ul>
            <li>
              <span className="text-sb3-text">#</span> または{" "}
              <span className="text-sb3-text">+</span> で半音上げる、{" "}
              <span className="text-sb3-text">-</span> で半音下げる
            </li>
          </ul>
        </li>
        <li>
          休符 <span className="text-sb3-string">R</span>
        </li>
        <li>
          音長 <span className="text-sb3-text">C</span>
          <span className="text-sb3-numeric">1</span> (ドの全音符),{" "}
          <span className="text-sb3-text">C</span>
          <span className="text-sb3-numeric">2</span> (ドの2分音符),{" "}
          <span className="text-sb3-text">C</span>
          <span className="text-sb3-numeric">4</span> (ドの4分音符) など
          <ul>
            <li>
              付点音符 <span className="text-sb3-text">C</span>
              <span className="text-sb3-numeric">4.</span> (付点4分音符)
            </li>
            <li>
              3連符は <span className="text-sb3-text">C</span>
              <span className="text-sb3-numeric">12</span> など
            </li>
          </ul>
        </li>
        <li>
          デフォルト音長 <span className="text-sb3-statement">L</span>
          <span className="text-sb3-numeric">1</span>,{" "}
          <span className="text-sb3-statement">L</span>
          <span className="text-sb3-numeric">2</span>,{" "}
          <span className="text-sb3-statement">L</span>
          <span className="text-sb3-numeric">4</span>...
          {/*- ピリオドで付点*/}
          {/*- 付点は2個以上指定可能 (`4..` = 4分音符 + 8分音符 + 16分音符)*/}
          {/*- (非公式情報) 192の約数でない数値を指定できるが、分解能(192分音符)より細かい長さは切り捨て (例: `L97` = `L192`) http://petitverse.hosiken.jp/community/petitcom/topic/?pg=0&read=1226*/}
          {/*- (非公式情報) 音符の音長を省略し付点だけつけた場合、 `L4.C.` はデフォルト音長から4を復元かつ付点1つを追加し `C4..` になる http://petitverse.hosiken.jp/community/petitcom/topic/?pg=0&read=1226*/}
        </li>
        <li>
          前後の音を繋ぐ <span className="text-sb3-string">&</span>
          {/*- `C4&C4` → `C2`と同じ*/}
          {/*- `C4&E4` → リリース・アタックなしで繋げて1つの2分音符になり、Cの音のピッチを途中からEに上げる*/}
          {/*- `&` のあとに他のコマンドを挟むと音の途中からそのコマンドが適用される*/}
        </li>
        <li>
          ポルタメント <span className="text-sb3-string">_</span>
          {/*- `C4_E4` → 1つの音で、 4分音符分の長さでCからEにピッチを線形に変化 + Eの高さで4分音符分伸ばす*/}
          {/*- ポルタメントの最後の音長を省略した場合に限り、 `C4_E` → 4分音符分の長さでCからEにピッチを線形に変化し伸ばさない*/}
          {/*- `L4C_D_E` = `C4_D4_E`*/}
          {/*- (非公式情報) `C4&D4_E` = `C4& (D4_E)` だが、同一音程のタイを含む場合に限り、 `C4&C4_E` = `(C4&C4)_E` = `C2_E` http://petitverse.hosiken.jp/community/petitcom/topic/?read=1558&ukey=0 http://petitverse.hosiken.jp/community/petitcom/diary/?read=5049&ukey=0*/}
        </li>
        <li>
          オクターブ <span className="text-sb3-statement">O0</span> 〜{" "}
          <span className="text-sb3-statement">O8</span>
          <ul>
            <li>
              オクターブを1上げる{" "}
              <span className="text-sb3-statement">&lt;</span>, 1下げる{" "}
              <span className="text-sb3-statement">&gt;</span>
            </li>
            {/*- オクターブ指定の反転 `!`*/}
          </ul>
        </li>
        <li>
          発音時間の割合(ゲート) <span className="text-sb3-statement">Q0</span>{" "}
          〜 <span className="text-sb3-statement">Q8</span>
        </li>
        <li>
          デチューン <span className="text-sb3-statement">@D-128</span>(-1半音)
          〜 <span className="text-sb3-statement">@D127</span>(+1半音)
        </li>
      </ul>
      <h4>音量・定位</h4>
      <ul>
        <li>
          ベロシティ <span className="text-sb3-statement">V0</span> 〜{" "}
          <span className="text-sb3-statement">V127</span>
          <ul>
            <li>
              ベロシティを1上げる <span className="text-sb3-statement">(</span>,
              1下げる <span className="text-sb3-statement">)</span>
            </li>
            <li>
              ベロシティを10上げる{" "}
              <span className="text-sb3-statement">(10</span>, 10下げる{" "}
              <span className="text-sb3-statement">)10</span>
            </li>
          </ul>
        </li>
        <li>
          音量 <span className="text-sb3-statement">@V0</span> 〜{" "}
          <span className="text-sb3-statement">@V127</span>
        </li>
        {/*- (非公式情報) SB3ではVが音量という公式の説明が誤りで、`V`がベロシティ、`@V`が音量。ベロシティはこれ以降のノートイベントにのみ反映される。音量は同じチャンネルですでに鳴っている音のリリースにも反映される。 http://petitverse.hosiken.jp/community/petitcom/topic/?read=1474&ukey=0*/}
        <li>
          パンポット <span className="text-sb3-statement">P0</span> 〜{" "}
          <span className="text-sb3-statement">P64</span>(中央) 〜{" "}
          <span className="text-sb3-statement">P127</span>
        </li>
        {/*- デフォルトは64。デフォルトで左右に偏った音源は、Pの指定がデフォルトからの変化量となり、`P0`で必ず左端になるわけではない*/}
      </ul>
      <h4>音色</h4>
      <ul>
        <li>
          音色 <span className="text-sb3-label">@0</span> 〜{" "}
          <span className="text-sb3-label">@511</span> (詳細は 音源設定 を参照)
        </li>
        <li>
          エンベロープ{" "}
          <span className="text-sb3-label">
            @E<var>attack</var>,<var>decay</var>,<var>sustain</var>,
            <var>release</var>
          </span>
          <ul>
            <li>各0〜127</li>
            <li>
              <var>attack</var>, <var>decay</var>, <var>release</var>{" "}
              は小さいほど遅い
            </li>
            {/*- (今新規に検証した非公式情報) BPM96の音符の長さ基準で(エンベロープはBPMに依存しないはず)、A=39が8分音符、A=19が4分音符、A=9が2分音符、A=4が全音符に相当する長さでのアタックになりました。リリースに関しては正確な検証は難しく多少誤差があるかもですが、S=127でもS=64でも、R=120が8分音符、R=114が4分音符、R=103が2分音符、R=91が全音符に相当する長さをかけて音量が0になるようなリリースになりました。DはS=0のときRとだいたい同じような仕様な気がしましたが、S=0でないときや音符の長さによって変わっている気もして、よくわかりませんでした。*/}
          </ul>
          <div className="alert alert-info p-1 gap-2 my-1">
            <span className="text-base">💡</span>
            <span><span className="text-sb3-label">100,100,100,100</span> から微調整するのがおすすめです</span>
          </div>
        </li>
        <li>
          エンベロープ解除 (音源のデフォルトに戻す){" "}
          <span className="text-sb3-label">@ER</span>
        </li>
      </ul>
      <h4>特殊効果 (モジュレーション)</h4>
      <ul>
        <li>
          トレモロ{" "}
          <span className="text-sb3-label">
            @MA<var>depth</var>,<var>range</var>,<var>speed</var>,
            <var>delay</var>
          </span>
        </li>
        <li>
          ビブラート{" "}
          <span className="text-sb3-label">
            @MP<var>depth</var>,<var>range</var>,<var>speed</var>,
            <var>delay</var>
          </span>
        </li>
        <li>
          オートパンポット{" "}
          <span className="text-sb3-label">
            @ML<var>depth</var>,<var>range</var>,<var>speed</var>,
            <var>delay</var>
          </span>
          <ul>
            <li>各0〜127</li>
            <li>
              <span className="text-sb3-label">@MA</span>,{" "}
              <span className="text-sb3-label">@MP</span>,{" "}
              <span className="text-sb3-label">@ML</span>{" "}
              は同時に使用できず、最後に指定したもののみが有効になる
            </li>
          </ul>
          <div className="alert alert-info p-1 gap-2 my-1">
            <span className="text-base">💡</span>
            <span><span className="text-sb3-label">64,1,16,16</span> から微調整するのがおすすめです</span>
          </div>
        </li>
        {/*- (非公式情報) 多少誤差があるかもですが、まず音の鳴り始めからBPM96の128分音符 (Delay) 個分相当の時間は変化がなく、その後BPM96の (Speed) 分音符相当の長さを1周期としたエフェクトがかかります。Speed=0のときはエフェクトはかかりません。@MLでは現在のパンポットから `±Depth*Range/2` の範囲で変化します。@MAでは現在の `V*@V/127` から `(V*@V/127)-(Depth*Range/2)` の範囲で音の大きさが変化します。@MPでは半音 `±Depth*Range/128` 個分の範囲で変化します。いずれもDepthとRangeの違いはわかりませんでした。 http://petitverse.hosiken.jp/community/petitcom/diary/?read=4221&ukey=0*/}
        <li>
          モジュレーション終了 <span className="text-sb3-label">@MOF</span>
        </li>
        <li>
          モジュレーション再開 <span className="text-sb3-label">@MON</span>
        </li>
      </ul>
    </div>
  );
}
