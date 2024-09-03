import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import {
  getRules,
  getClashConfig,
  closeAllConnections,
  updateConfigs,
} from "@/services/api";
import { BaseEmpty, BasePage, Notice } from "@/components/base";
import RuleItem from "@/components/rule/rule-item";
import { ProviderButton } from "@/components/rule/provider-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { BaseSearchBox } from "@/components/base/base-search-box";
import {
  Box,
  Button,
  Grid,
  IconButton,
  Stack,
  ButtonGroup,
} from "@mui/material";
import { BaseStyledTextField } from "@/components/base/base-styled-text-field";
import { readText } from "@tauri-apps/api/clipboard";
import {
  ClearRounded,
  ContentPasteRounded,
  LocalFireDepartmentRounded,
  RefreshRounded,
  TextSnippetOutlined,
} from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import {
  ProfileViewer,
  ProfileViewerRef,
} from "@/components/profile/profile-viewer";
import {
  getProfiles,
  importProfile,
  enhanceProfiles,
  getRuntimeLogs,
  deleteProfile,
  updateProfile,
  reorderProfile,
  createProfile,
} from "@/services/cmds";
import useSWR, { mutate } from "swr";
import { useProfiles } from "@/hooks/use-profiles";
import { ProxyGroups } from "@/components/proxy/proxy-groups";
import { useVerge } from "@/hooks/use-verge";
import { useLockFn } from "ahooks";
import getSystem from "@/utils/get-system";
import {
  installService,
  uninstallService,
  checkService,
  patchClashConfig,
} from "@/services/cmds";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { ProfileItem } from "@/components/profile/profile-item";
import { ProfileMore } from "@/components/profile/profile-more";
import { useSetLoadingCache, useThemeMode } from "@/services/states";

const QuickPage = () => {
  const { t } = useTranslation();
  const { data = [] } = useSWR("getRules", getRules);
  const { theme } = useCustomTheme();
  const isDark = theme.palette.mode === "dark";
  const [match, setMatch] = useState(() => (_: string) => true);

  const rules = useMemo(() => {
    return data.filter((item) => match(item.payload));
  }, [data, match]);

  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [activatings, setActivatings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const onCopyLink = async () => {
    const text = await readText();
    if (text) setUrl(text);
  };

  const {
    profiles = {},
    activateSelected,
    patchProfiles,
    mutateProfiles,
  } = useProfiles();

  const { data: chainLogs = {}, mutate: mutateLogs } = useSWR(
    "getRuntimeLogs",
    getRuntimeLogs
  );

  const onImport = async () => {
    if (!url) return;
    setLoading(true);

    try {
      await importProfile(url);
      Notice.success(t("Profile Imported Successfully"));
      setUrl("");
      setLoading(false);

      getProfiles().then(async (newProfiles) => {
        mutate("getProfiles", newProfiles);

        const remoteItem = newProfiles.items?.find((e) => e.type === "remote");
        if (newProfiles.current && remoteItem) {
          const current = remoteItem.uid;
          await patchProfiles({ current });
          mutateLogs();
          setTimeout(() => activateSelected(), 2000);
        }
      });
    } catch (err: any) {
      Notice.error(err.message || err.toString());
      setLoading(false);
    } finally {
      setDisabled(false);
      setLoading(false);
    }
  };

  const viewerRef = useRef<ProfileViewerRef>(null);

  const { data: clashConfig, mutate: mutateClash } = useSWR(
    "getClashConfig",
    getClashConfig
  );
  const curMode = clashConfig?.mode?.toLowerCase();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        await reorderProfile(active.id.toString(), over.id.toString());
        mutateProfiles();
      }
    }
  };

  const profileItems = useMemo(() => {
    const items = profiles.items || [];

    const type1 = ["local", "remote"];

    const profileItems = items.filter((i) => i && type1.includes(i.type!));

    return profileItems;
  }, [profiles]);

  const isEmpty = profileItems.length === 0;

  const currentActivatings = () => {
    return [...new Set([profiles.current ?? ""])].filter(Boolean);
  };

  const onSelect = useLockFn(async (current: string, force: boolean) => {
    if (!force && current === profiles.current) return;
    // 避免大多数情况下loading态闪烁
    const reset = setTimeout(() => {
      setActivatings([...currentActivatings(), current]);
    }, 100);
    try {
      await patchProfiles({ current });
      await mutateLogs();
      closeAllConnections();
      activateSelected().then(() => {
        Notice.success(t("Profile Switched"), 1000);
      });
    } catch (err: any) {
      Notice.error(err?.message || err.toString(), 4000);
    } finally {
      clearTimeout(reset);
      setActivatings([]);
    }
  });

  const onEnhance = useLockFn(async () => {
    setActivatings(currentActivatings());
    try {
      await enhanceProfiles();
      mutateLogs();
      Notice.success(t("Profile Reactivated"), 1000);
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 3000);
    } finally {
      setActivatings([]);
    }
  });

  const onDelete = useLockFn(async (uid: string) => {
    const current = profiles.current === uid;
    try {
      setActivatings([...(current ? currentActivatings() : []), uid]);
      await deleteProfile(uid);
      mutateProfiles();
      mutateLogs();
      current && (await onEnhance());
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    } finally {
      setActivatings([]);
    }
  });

  const mode = useThemeMode();
  const islight = mode === "light" ? true : false;
  const dividercolor = islight
    ? "rgba(0, 0, 0, 0.06)"
    : "rgba(255, 255, 255, 0.06)";

  const { verge, mutateVerge, patchVerge } = useVerge();
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  const { data: serviceStatus, mutate: themutate } = useSWR(
    "checkService",
    checkService,
    {
      revalidateIfStale: false,
      shouldRetryOnError: false,
      focusThrottleInterval: 36e5, // 1 hour
    }
  );

  const isWindows = getSystem() === "windows";
  const isActive = serviceStatus === "active";
  const isInstalled = serviceStatus === "installed";
  const isUninstall =
    serviceStatus === "uninstall" || serviceStatus === "unknown";
  const [serviceLoading, setServiceLoading] = useState(false);
  const [openInstall, setOpenInstall] = useState(false);
  const [openUninstall, setOpenUninstall] = useState(false);
  const [uninstallServiceLoaing, setUninstallServiceLoading] = useState(false);

  // const mutate = 'active';

  async function install(passwd: string) {
    try {
      setOpenInstall(false);
      await installService(passwd);
      await themutate();
      setTimeout(() => {
        themutate();
      }, 2000);
      Notice.success(t("Service Installed Successfully"));
      setServiceLoading(false);
    } catch (err: any) {
      await themutate();
      setTimeout(() => {
        themutate();
      }, 2000);
      Notice.error(err.message || err.toString());
      setServiceLoading(false);
    }
  }
  const onInstallOrEnableService = useLockFn(async () => {
    setServiceLoading(true);
    if (isUninstall) {
      // install service
      if (isWindows) {
        await install("");
      } else {
        setOpenInstall(true);
      }
    } else {
      try {
        // enable or disable service
        await patchVerge({ enable_service_mode: !isActive });
        onChangeData({ enable_service_mode: !isActive });
        await themutate();
        setTimeout(() => {
          themutate();
        }, 2000);
        setServiceLoading(false);
      } catch (err: any) {
        await themutate();
        Notice.error(err.message || err.toString());
        setServiceLoading(false);
      }
    }
  });

  async function uninstall(passwd: string) {
    try {
      setOpenUninstall(false);
      await uninstallService(passwd);
      await themutate();
      setTimeout(() => {
        themutate();
      }, 2000);
      Notice.success(t("Service Uninstalled Successfully"));
      setUninstallServiceLoading(false);
    } catch (err: any) {
      await themutate();
      setTimeout(() => {
        themutate();
      }, 2000);
      Notice.error(err.message || err.toString());
      setUninstallServiceLoading(false);
    }
  }
  const onUninstallService = useLockFn(async () => {
    setUninstallServiceLoading(true);
    if (isWindows) {
      await uninstall("");
    } else {
      setOpenUninstall(true);
    }
  });

  const [result, setResult] = useState(false);

  useEffect(() => {
    if (data) {
      const { enable_tun_mode, enable_system_proxy, enable_service_mode } =
        verge ?? {};

      // 当 enable_tun_mode, enable_system_proxy, enable_service_mode 同为 true 时，result 为 true
      // 否则，result 为 false
      // setResult(enable_tun_mode && enable_system_proxy && enable_service_mode);
      setResult(
        !!(enable_tun_mode && enable_system_proxy && enable_service_mode)
      );
    }
  }, [data]);

  const link = async () => {
    if (!isEmpty) {
      onInstallOrEnableService();
      await patchVerge({ enable_service_mode: true });
      onChangeData({ enable_service_mode: true });
      onChangeData({ enable_tun_mode: true });
      patchVerge({ enable_tun_mode: true });
      onChangeData({ enable_system_proxy: true });
      patchVerge({ enable_system_proxy: true });
      setResult(true);
    } else {
      Notice.error(t("Profiles Null"));
    }
  };

  const cancelink = async () => {
    await patchVerge({ enable_service_mode: false });
    onChangeData({ enable_service_mode: false });
    onChangeData({ enable_tun_mode: false });
    patchVerge({ enable_tun_mode: false });
    onChangeData({ enable_system_proxy: false });
    patchVerge({ enable_system_proxy: false });
    setResult(false);
  };

  const modeList = ["rule", "global", "direct"];
  const onChangeMode = useLockFn(async (mode: string) => {
    // 断开连接
    if (mode !== curMode && verge?.auto_close_connection) {
      closeAllConnections();
    }
    await updateConfigs({ mode });
    await patchClashConfig({ mode });
    mutateClash();
  });
  useEffect(() => {
    if (curMode && !modeList.includes(curMode)) {
      onChangeMode("rule");
    }
  }, [curMode]);

  return (
    <BasePage
      title={t("Quick")}
      contentStyle={{ height: "100%" }}
      header={
        <Box display="flex" alignItems="center" gap={1}>
          <ProviderButton />

          <ButtonGroup size="small">
            {modeList.map((mode) => (
              <Button
                key={mode}
                variant={mode === curMode ? "contained" : "outlined"}
                onClick={() => onChangeMode(mode)}
                sx={{ textTransform: "capitalize" }}
              >
                {t(mode)}
              </Button>
            ))}
          </ButtonGroup>
        </Box>
      }
    >
      <div className="quickCon">
        {result ? (
          <div className="aquickCon1">
            <div className="aquickCon2">
              <div className="aquick" onClick={cancelink}>
                {t("Close Connection")}
              </div>
            </div>
          </div>
        ) : (
          <div className="quickCon1">
            <div className="quickCon2">
              <div className="quick" onClick={link}>
                {t("Quick Connection")}
              </div>
            </div>
          </div>
        )}
      </div>

      <Stack
        direction="row"
        spacing={1}
        sx={{
          pt: 1,
          mb: 0.5,
          mx: "10px",
          height: "36px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <BaseStyledTextField
          value={url}
          variant="outlined"
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("Profile URL")}
          InputProps={{
            sx: { pr: 1 },
            endAdornment: !url ? (
              <IconButton
                size="small"
                sx={{ p: 0.5 }}
                title={t("Paste")}
                onClick={onCopyLink}
              >
                <ContentPasteRounded fontSize="inherit" />
              </IconButton>
            ) : (
              <IconButton
                size="small"
                sx={{ p: 0.5 }}
                title={t("Clear")}
                onClick={() => setUrl("")}
              >
                <ClearRounded fontSize="inherit" />
              </IconButton>
            ),
          }}
        />
        <LoadingButton
          disabled={!url || disabled}
          loading={loading}
          variant="contained"
          size="small"
          sx={{ borderRadius: "6px" }}
          onClick={onImport}
        >
          {t("Import")}
        </LoadingButton>
      </Stack>
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          pl: "10px",
          mr: "10px",
          overflowY: "auto",
        }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <Box sx={{ mb: 1.5 }}>
            <Grid container spacing={{ xs: 1, lg: 1 }}>
              <SortableContext
                items={profileItems.map((x) => {
                  return x.uid;
                })}
              >
                {profileItems.map((item) => (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={item.file}>
                    <ProfileItem
                      id={item.uid}
                      selected={profiles.current === item.uid}
                      activating={activatings.includes(item.uid)}
                      itemData={item}
                      onSelect={(f) => onSelect(item.uid, f)}
                      onEdit={() => viewerRef.current?.edit(item)}
                      onSave={async (prev, curr) => {
                        if (prev !== curr && profiles.current === item.uid) {
                          await onEnhance();
                        }
                      }}
                      onDelete={() => onDelete(item.uid)}
                    />
                  </Grid>
                ))}
              </SortableContext>
            </Grid>
          </Box>
        </DndContext>
      </Box>
      <ProxyGroups mode={curMode!} />
    </BasePage>
  );
};

export default QuickPage;
