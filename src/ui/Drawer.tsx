import { useSyncExternalStore } from 'react';
import { DRAWER_TABS, uiStore, type DrawerTab } from '../app/uiState';
import { HierarchyPanel } from './HierarchyPanel';
import { Icon } from './icons';
import { Inspector } from './Inspector';
import { LibraryPanel } from './LibraryPanel';
import { VersionsPanel } from './VersionsPanel';

const TAB_INFO: Record<DrawerTab, { label: string }> = {
  parts: { label: 'Parts' },
  properties: { label: 'Properties' },
  library: { label: 'My Parts' },
  versions: { label: 'Versions' },
};

/** The side drawer over the 3D view. Hidden until opened, so the board and the object get the room. */
export function Drawer() {
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.getState);
  if (!ui.drawerOpen) return null;
  return (
    <aside className="drawer" aria-label="Parts and properties">
      <div className="drawer-tabs" role="tablist">
        {DRAWER_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={ui.drawerTab === tab}
            className={ui.drawerTab === tab ? 'is-active' : ''}
            onClick={() => uiStore.set({ drawerTab: tab })}
          >
            {TAB_INFO[tab].label}
          </button>
        ))}
        <button type="button" className="icon-button is-small drawer-close" aria-label="Close the panel" title="Close (Ctrl+B)" onClick={() => uiStore.set({ drawerOpen: false })}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="drawer-body" role="tabpanel">
        {ui.drawerTab === 'parts' && <HierarchyPanel />}
        {ui.drawerTab === 'properties' && <Inspector />}
        {ui.drawerTab === 'library' && <LibraryPanel />}
        {ui.drawerTab === 'versions' && <VersionsPanel />}
      </div>
    </aside>
  );
}
