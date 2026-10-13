import clsx from "clsx";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  loadFile: (file: File) => void;
}

export function WithHeaderAndSidebar(props: Props) {
  return (
    <>
      <header className="navbar bg-base-100">
        <div className="navbar-start">
          <label
            htmlFor="SidebarToggle"
            className="lg:hidden btn btn-ghost w-max"
          >
            <svg
              aria-label="Menu"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              className="inline-block h-5 w-5 stroke-current"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 6h16M4 12h16M4 18h16"
              ></path>
            </svg>
            ファイル
          </label>
        </div>
        <h1 className="navbar-center mx-4 text-2xl font-semibold">
          <img src="/favicon-white.svg" className="size-10 mr-2" />
          SmileMML
        </h1>
        <div className="navbar-end"></div>
      </header>

      <div className="drawer lg:drawer-open">
        <input type="checkbox" id="SidebarToggle" className="drawer-toggle" />
        <div className="drawer-content flex flex-col items-center p-2 sm:p-4 md:p-8">
          {/* Page content here */}
          {props.children}
        </div>
        <div className="drawer-side">
          <label
            htmlFor="SidebarToggle"
            aria-label="close sidebar"
            className="drawer-overlay"
          />
          <div className="bg-base-200 h-full w-80 p-2 sm:p-4 flex flex-col space-y-2">
            <SidebarContent {...props} />
          </div>
        </div>
      </div>
    </>
  );
}

function SidebarContent(props: Props) {
  return (
    <>
      <h3 className="font-semibold text-lg">MMLを選択</h3>
      <div
        className={clsx(
          "min-h-0 shrink overflow-y-auto bg-base-200",
          "scrollbar-thumb-current/35 scrollbar-track-transparent",
        )}
      >
        <ul className="menu w-full h-max p-0">
          <li>
            <button className="text-base-content/70">サンプル1</button>
          </li>
          <li>
            <button className="text-base-content/70">サンプル2</button>
          </li>
          <li>
            <button className="">hoge</button>
          </li>
          <li>
            <button className="">hoge</button>
          </li>
          <li>
            <button className="menu-active">無題</button>
          </li>
          <li>
            <button className="justify-center">+ 新規作成</button>
          </li>
        </ul>
      </div>
      <div className="divider" />
      <h3 className="font-semibold text-lg">ファイルをインポート</h3>
      <p className="mx-2 text-paragraph text-sm">
        .MML ファイルを読み込むことができます。
      </p>
      <div className="flex justify-center">
        <label
          htmlFor="SidebarImportMML"
          className="btn btn-primary btn-soft btn-sm"
        >
          ファイルを選択...
        </label>
        <input
          type="file"
          id="SidebarImportMML"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              props.loadFile(e.target.files[0]);
            }
          }}
        />
      </div>
      <div className="divider" />
      <h3 className="font-semibold text-lg">ファイルをエクスポート</h3>
      <div>TODO</div>
    </>
  );
}
