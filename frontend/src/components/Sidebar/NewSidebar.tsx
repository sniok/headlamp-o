/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Icon, IconifyIcon } from '@iconify/react';
import { alpha, Box, useTheme } from '@mui/material';
import { isValidElement, memo, ReactNode, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { generatePath, useLocation } from 'react-router';
import { NavLink } from 'react-router-dom';
import { getClusterPrefixedPath } from '../../lib/cluster';
import { useSelectedClusters } from '../../lib/k8s';
import { createRouteURL, getRoute } from '../../lib/router';
import { useTypedSelector } from '../../redux/hooks';
import { favoriteSlice } from '../../redux/reducers/reducers';
import store from '../../redux/stores/store';
import { Activity } from '../activity/Activity';
import ClusterChooserPopup from '../cluster/ClusterChooserPopup';
import { CreateButton } from '../common';
import { KubeIcon } from '../resourceMap/kubeIcon/KubeIcon';
import { SidebarEntry } from './sidebarSlice';
import { useSidebarItems } from './useSidebarItems';

type Entry = SidebarEntry & { subList?: Entry[]; divider?: boolean; onClick?: any };

const height = '34px';
const iconSize = 20;

const ItemElement = memo(function ItemElement({
  icon,
  label,
  children,
  url,
  divider,
  isCompactIcon,
  isHovered,
  open,
  setOpen,
  onClick,
}: {
  label: ReactNode;
  icon?: string | IconifyIcon | ReactNode;
  children?: ReactNode;
  divider?: boolean;
  url?: string;
  isCompactIcon?: boolean;
  isHovered?: boolean;
  open: boolean;
  setOpen: (newOpen: boolean) => void;
  onClick?: () => void;
}) {
  const hasChildren = !!children;

  const theme = useTheme();

  const isLink = !!url;

  return (
    <>
      <Box
        sx={theme => ({
          display: 'flex',
          fontSize: '14px',
          userSelect: 'none',
          // px: 1,
          paddingRight: 0,
          color: theme.palette.sidebar.color,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
          // width: isCompactIcon && !isHovered ? '43px' : '100%',
          // transition: 'width 0.4s',
          borderRadius: '6px',
          overflow: 'hidden',
        })}
        onClick={onClick}
      >
        {isLink ? (
          <>
            <NavLink
              to={url ?? '#'}
              activeStyle={{
                background: theme.palette.sidebar.selectedBackground,
                color: theme.palette.getContrastText(theme.palette.sidebar.selectedBackground),
              }}
              exact
              onClick={() => setOpen(true)}
              style={{
                width: '100%',
                minWidth: '46px',
                color: theme.palette.sidebar.color,
                textDecoration: 'none',
                flexGrow: 1,
                borderRadius: theme.shape.borderRadius + 'px',
                borderTopRightRadius: hasChildren ? 0 : theme.shape.borderRadius + 'px',
                borderBottomRightRadius: hasChildren ? 0 : theme.shape.borderRadius + 'px',
                // minWidth: 0,
              }}
            >
              <Box
                sx={theme => ({
                  px: '9px',
                  width: '100%',
                  height,
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: theme.shape.borderRadius + 'px',
                  gap: 1.0,

                  borderTopRightRadius: hasChildren ? 0 : undefined,
                  borderBottomRightRadius: hasChildren ? 0 : undefined,

                  cursor: 'pointer',
                  flexGrow: 1,
                  ':hover': {
                    background: alpha(
                      theme.palette.action.hover,
                      theme.palette.action.hoverOpacity
                    ),
                  },
                  ':active': {
                    background: alpha(
                      theme.palette.action.active,
                      theme.palette.action.activatedOpacity
                    ),
                  },
                })}
              >
                {icon && typeof icon === 'string' && icon.startsWith('kube:') && (
                  <KubeIcon
                    kind={icon.split(':')[1] as any}
                    width={iconSize + 'px'}
                    disableBackground
                    disableColor
                    style={{ opacity: 0.7, flexShrink: 0 }}
                  />
                )}
                {isValidElement(icon)
                  ? icon
                  : icon &&
                    !(icon as any).startsWith('kube:') && (
                      <Icon
                        icon={icon as string}
                        width={iconSize}
                        style={{ opacity: 0.7, flexShrink: 0 }}
                      />
                    )}

                <Box sx={{ textOverflow: 'ellipsis', overflow: 'hidden', flexShrink: 1 }}>
                  {label}
                </Box>
              </Box>
            </NavLink>
            {hasChildren && (
              <Box
                sx={theme => ({
                  cursor: 'pointer',
                  width: '32px',
                  flexShrink: 0,
                  alignSelf: 'stretch',
                  borderRadius: theme.shape.borderRadius + 'px',
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderLeft: '1px solid',
                  borderColor: theme.palette.divider,
                  userSelect: 'none',
                  ':hover': {
                    background: alpha(
                      theme.palette.action.hover,
                      theme.palette.action.hoverOpacity
                    ),
                  },
                  ':active': {
                    background: alpha(
                      theme.palette.action.active,
                      theme.palette.action.activatedOpacity
                    ),
                  },
                })}
                onClick={() => setOpen(!open)}
              >
                <Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={iconSize} />
              </Box>
            )}
          </>
        ) : (
          <Box
            sx={theme => ({
              width: '100%',
              px: '9px',
              paddingRight: 0,
              height,
              cursor: 'pointer',
              borderRadius: theme.shape.borderRadius + 'px',
              display: 'flex',
              flexGrow: 1,
              alignItems: 'center',
              gap: 1.0,
              borderColor: theme.palette.divider,
              ':hover': {
                background: alpha(theme.palette.action.hover, theme.palette.action.hoverOpacity),
              },
              ':active': {
                background: alpha(
                  theme.palette.action.active,
                  theme.palette.action.activatedOpacity
                ),
              },
            })}
            onClick={() => setOpen(!open)}
          >
            {isValidElement(icon) ? (
              <Box
                sx={{ width: iconSize + 'px', height: iconSize + 'px', flexShrink: 0, scale: 1.2 }}
              >
                {icon}
              </Box>
            ) : (
              icon &&
              !(icon as any).startsWith('kube:') && (
                <Icon
                  icon={icon as string}
                  width={iconSize}
                  style={{ opacity: 0.7, flexShrink: 0 }}
                />
              )
            )}
            <Box
              sx={{ minWidth: '46px', textOverflow: 'ellipsis', overflow: 'hidden', flexShrink: 1 }}
            >
              {label}
            </Box>

            {hasChildren && (
              <Box
                sx={{
                  marginLeft: 'auto',
                  width: '32px',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={iconSize} />
              </Box>
            )}
          </Box>
        )}
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          ml: !isCompactIcon || isHovered ? 1.5 : 0,
          transition: 'margin-left 0.2s',
          transitionDelay: isCompactIcon && isHovered ? '0.2s' : '0.2s',
          borderBottom: divider ? '1px solid' : undefined,
          borderColor: theme.palette.divider,
          // borderLeft: '2px solid',
          borderLeftColor: alpha(theme.palette.sidebar.actionBackground, 0.7),
          // paddingBottom: divider ? 0.7 : undefined,
          marginBottom: divider ? 0.7 : undefined,
          marginTop: divider ? 0.7 : undefined,
          paddingLeft: '1px',
          // transition: 'height 0.4s, width 0.4s',
          // height: isCompactIcon && !isHovered ? '0px' : 'calc-size(max-content, size)',
          // width: isCompactIcon && !isHovered ? '43px' : '100%',
          overflow: 'hidden',
        }}
      >
        {open && children}
      </Box>
    </>
  );
});

const Item = memo(function Item({
  item,
  isCompactIcon,
  isHovered,
}: {
  item: Entry;
  isCompactIcon: boolean;
  isHovered?: boolean;
}) {
  const selectedItem = useTypedSelector(state => state.sidebar.selected?.item);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let open = false;
    const selectedItemName = store.getState().sidebar.selected?.item;

    const checkForSelected = (item: Entry) => {
      if (open) return; // we already determined

      if (item.name === selectedItemName) {
        open = true;
        return;
      }

      item.subList?.forEach(subItem => checkForSelected(subItem));
    };
    checkForSelected(item);

    if (open) {
      setOpen(true);
    }
  }, [selectedItem]);

  const selectedClusters = useSelectedClusters();

  let fullURL = item.url;
  if (fullURL && item.useClusterURL && selectedClusters.length > 0) {
    fullURL = generatePath(getClusterPrefixedPath(item.url), {
      cluster: selectedClusters.join('+'),
    });
  }

  if (!fullURL) {
    const routeName = item.name;

    if (getRoute(item.name)) {
      fullURL = createRouteURL(routeName);
    }
  }

  return (
    <ItemElement
      label={item.label}
      url={fullURL}
      icon={item.icon}
      divider={item.divider}
      isCompactIcon={isCompactIcon}
      isHovered={isHovered}
      onClick={item.onClick}
      open={open}
      setOpen={setOpen}
    >
      {item.subList?.map(it => (
        <Item item={it} key={it.name} isCompactIcon={isCompactIcon} />
      ))}
    </ItemElement>
  );
});

function useFavorites(): Entry {
  const favorites = useTypedSelector(state => state.favorites.items);
  // const [favorites, setFavorites] = useState<{ url: string; title: string }[]>([]);
  const location = useLocation();
  const dispatch = useDispatch();
  const addFavorites = (f: any) => dispatch(favoriteSlice.actions.add(f));

  return useMemo(
    () => ({
      label: 'Favorites',
      icon: 'mdi:star',
      name: 'home',
      subList: [
        {
          label: 'Add current page',
          name: 'add-current-page',
          icon: 'mdi:plus',
          onClick: () => {
            addFavorites({ url: location.pathname + location.search, title: document.title });
          },
        },
        ...favorites.map(it =>
          it.activity
            ? {
                label: it.activity.title,
                name: it.activity.id,
                icon: it.activity.icon,
                onClick: () => {
                  Activity.launch(it.activity);
                },
              }
            : {
                label: it.title,
                name: 'favorite' + it.url,
                url: it.url,
              }
        ),
      ],
    }),
    [favorites]
  );
}

function useClusters() {
  const selectedClusters = useSelectedClusters();

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  return [
    anchorEl,
    setAnchorEl,
    useMemo(
      () => ({
        label:
          selectedClusters.length === 1
            ? selectedClusters[0]
            : `${selectedClusters.length} clusters`,
        name: 'home',
        icon: 'mdi:hexagon-multiple-outline',
        onClick: event => {
          setAnchorEl(event.currentTarget);
        },
      }),
      [selectedClusters]
    ),
  ] as const;
}

const PureNewSidebar = memo(function ({
  anchorEl,
  setAnchorEl,
  isSidebarOpen,
  isHovered,
  setIsHovered,
  favorites,
  updatedItems,
}: {
  anchorEl;
  setAnchorEl;
  isSidebarOpen;
  isHovered;
  setIsHovered;
  favorites;
  updatedItems;
}) {
  return (
    <>
      <ClusterChooserPopup anchor={anchorEl} onClose={() => setAnchorEl(null)} />

      {!isSidebarOpen && <Box sx={{ width: '55px' }} />}
      <Box
        sx={theme => ({
          position: isSidebarOpen ? 'initial' : 'absolute',
          zIndex: 11,
          width: isSidebarOpen || isHovered ? '250px' : '56px',
          boxShadow: !isSidebarOpen && isHovered ? '2px 0px 15px rgba(0,0,0,0.1)' : '',
          transition: 'width 0.4s, box-shadow 0.4s',
          transitionDelay: isHovered ? '0.2s' : '0.2s',
          willChange: 'width',
          overflowX: 'hidden',
          flexShrink: 0,
          background: theme.palette.sidebar.background,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid',
          borderColor: theme.palette.divider,
          py: 1,
          px: 0.5,
          overflowY: 'auto',
          scrollbarGutter: 'stable',
          scrollbarWidth: 'thin',
          interpolateSize: 'allow-keywords',
          gridRow: '1/3',
        })}
        onPointerEnter={() => {
          if (!isSidebarOpen) {
            setIsHovered(true);
          }
        }}
        onPointerLeave={() => {
          if (!isSidebarOpen) {
            setIsHovered(false);
          }
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[favorites, ...updatedItems].filter(Boolean).map(it => (
            <Item key={it.name} item={it} isCompactIcon={!isSidebarOpen} isHovered={isHovered} />
          ))}
        </Box>
        <Box
          sx={{
            position: 'sticky',
            bottom: 0,
            marginTop: 'auto',
            display: 'flex',
            justifyContent: 'center',
            paddingBottom: 3,
            paddingX: '1px',
          }}
        >
          <Box
            sx={theme => ({
              boxShadow: theme.shadows[2],
              borderRadius: theme.shape.borderRadius + 'px',
              overflow: 'hidden',
              background: theme.palette.sidebar.background,
            })}
          >
            <CreateButton />
          </Box>
        </Box>
      </Box>
    </>
  );
});

export function NewSidebar() {
  const isSidebarOpen = useTypedSelector(state => state.sidebar.isSidebarOpen);
  const selectedSidebar = useTypedSelector(state => state.sidebar.selected?.sidebar);
  const items = useSidebarItems(selectedSidebar ?? undefined) as Entry[];
  const favorites = useFavorites();
  const [anchorEl, setAnchorEl, clusters] = useClusters();
  const [isHovered, setIsHovered] = useState(false);

  const updatedItems = useMemo(() => {
    const newItems: any[] = [];

    items.forEach(it => {
      newItems.push(it);
      if (it.label === 'Settings') {
        newItems.push(clusters);
      }
    });

    return newItems;
  }, [items, clusters]);

  return (
    <PureNewSidebar
      anchorEl={anchorEl}
      favorites={favorites}
      isHovered={isHovered}
      isSidebarOpen={isSidebarOpen}
      setAnchorEl={setAnchorEl}
      setIsHovered={setIsHovered}
      updatedItems={updatedItems}
    />
  );
}
