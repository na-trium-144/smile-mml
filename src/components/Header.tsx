import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  loadFile: (file: File) => void;
}
export function WithHeaderAndSidebar(props: Props) {
  return (
    <>
      <header className="navbar bg-base-100">
        <div className="flex-none">
          <label htmlFor="SidebarToggle" className="btn btn-square btn-ghost">
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
          </label>
        </div>
        <h1 className="flex-1 text-xl">SmileMML</h1>
      </header>

      <div className="drawer lg:drawer-open">
        <input type="checkbox" id="SidebarToggle" className="drawer-toggle" />
        <div className="drawer-content flex flex-col items-center justify-center p-8">
          {/* Page content here */}
          {props.children}
        </div>
        <div className="drawer-side">
          <label
            htmlFor="SidebarToggle"
            aria-label="close sidebar"
            className="drawer-overlay"
          />
          <ul className="menu bg-base-200 min-h-full w-80 p-4">
            {/* Sidebar content here */}
            <input
              type="file"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  loadFile(e.target.files[0]);
                }
              }}
            />
          </ul>
        </div>
      </div>
    </>
  );
}
