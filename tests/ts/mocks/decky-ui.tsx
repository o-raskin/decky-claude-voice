import { vi } from "vitest";

/* Light stand-ins for Steam's components. Each node keeps its props so tests can fire gamepad handlers. */
const KEY = "__cvProps";
export const propsOf = (el: Element | null): any => (el as any)?.[KEY] ?? {};
const keep = (el: any, props: any) => {
  if (el) el[KEY] = props;
};


export function Focusable(props: any) {
  const { children, className, style, onClick, onClickCapture, onContextMenu, onGamepadFocus, onGamepadBlur } = props;
  return (
    <div
      ref={(el) => keep(el, props)}
      tabIndex={-1}
      className={className}
      style={style}
      onClick={onClick}
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
      onFocus={(e) => onGamepadFocus?.(e)}
      onBlur={(e) => onGamepadBlur?.(e)}
    >
      {children}
    </div>
  );
}

export function DialogButton(props: any) {
  const { children, className, style, onClick, disabled, onMouseDown, onGamepadFocus, onGamepadBlur } = props;
  return (
    <button
      ref={(el) => keep(el, props)}
      className={className}
      style={style}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onFocus={(e) => onGamepadFocus?.(e)}
      onBlur={(e) => onGamepadBlur?.(e)}
    >
      {children}
    </button>
  );
}

export function TextField({ value, onChange, placeholder, disabled }: any) {
  return <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} />;
}

export function ScrollPanel({ children }: any) {
  return (
    <div className="scrollpanel" style={{ overflowY: "auto" }}>
      {children}
    </div>
  );
}

export function Dropdown({ rgOptions, selectedOption, onChange, disabled, renderButtonValue, menuLabel }: any) {
  return (
    <div className="dropdown" data-label={menuLabel} data-selected={selectedOption} data-disabled={String(!!disabled)}>
      <div className="dropdown-value">{renderButtonValue?.()}</div>
      {rgOptions.map((o: any) => (
        <button key={o.data} data-opt={o.data} onClick={() => onChange(o)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ButtonItem({ children, onClick, disabled, layout }: any) {
  return (
    <button className="buttonitem" data-layout={layout} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export const PanelSection = ({ children, title }: any) => (
  <section data-title={title}>{title && <h3>{title}</h3>}{children}</section>
);
export const PanelSectionRow = ({ children }: any) => <div className="row">{children}</div>;

export const Menu = ({ label, cancelText, children }: any) => (
  <div className="menu" data-label={label} data-cancel={cancelText}>{children}</div>
);
export const MenuGroup = ({ label, disabled, children }: any) => (
  <div className="menugroup" data-label={label} data-disabled={String(!!disabled)}>{children}</div>
);
export const MenuItem = ({ children, onSelected }: any) => <button className="menuitem" onClick={onSelected}>{children}</button>;

export const showContextMenu = vi.fn();
export const Router: any = { MainRunningApp: null as any };
export const Navigation = { CloseSideMenus: vi.fn(), Navigate: vi.fn() };
export const staticClasses = { Title: "title" };
