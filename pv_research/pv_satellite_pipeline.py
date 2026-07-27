"""
GOES-17 satellite imagery <-> SKIPD ground-sky-camera <-> PV output pipeline.

Ported from Colab notebook (SKIIPGOES.ipynb). Run locally in VS Code:
    pip install -r requirements.txt
    python pv_satellite_pipeline.py --target-day 2019-08-10

Research plan (4 phases):
  1. Satellite <-> ground-camera image pattern matching vs PV        <- this script
  2. + historical weather + numerical weather prediction (NWP) data
  3. XAI over the learned features/model
  4. Multimodal transformer fusion -> PV generation forecast
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path

import h5py
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
import xarray as xr
from pvlib import solarposition


# --------------------------------------------------------------------------
# Config — edit paths for your machine, or override via CLI flags.
# --------------------------------------------------------------------------

@dataclass
class Config:
    data_dir: Path = Path(os.environ.get("PV_DATA_DIR", "./data"))
    goes_cache_dir: Path = Path(os.environ.get("GOES_CACHE_DIR", "./data/goes_cache"))
    hdf5_path: Path = None
    times_train_path: Path = None
    times_test_path: Path = None
    matched_csv_path: Path = None
    features_out_path: Path = None

    site_lat: float = 37.427   # Stanford, CA (SKIPD site)
    site_lon: float = -122.174
    patch_size: int = 64       # half-width in pixels
    satellite_number: int = 17
    product: str = "ABI-L2-MCMIPC"
    domain: str = "F"

    def __post_init__(self):
        self.hdf5_path = self.hdf5_path or self.data_dir / "2017_2019_images_pv_processed.hdf5"
        self.times_train_path = self.times_train_path or self.data_dir / "times_trainval.npy"
        self.times_test_path = self.times_test_path or self.data_dir / "times_test.npy"
        self.matched_csv_path = self.matched_csv_path or self.data_dir / "matched_aug10.csv"
        self.features_out_path = self.features_out_path or self.data_dir / "features_2019.parquet"
        self.goes_cache_dir.mkdir(parents=True, exist_ok=True)


REFLECTIVE_BANDS = ["CMI_C02", "CMI_C03", "CMI_C05"]
REFLECTIVE_DQF = ["DQF_C02", "DQF_C03", "DQF_C05"]
IR_BAND = "CMI_C13"
IR_DQF = "DQF_C13"


# --------------------------------------------------------------------------
# 1. Load SKIPD PV / sky-image dataset
# --------------------------------------------------------------------------

def load_pv_dataframe(cfg: Config) -> tuple[pd.DataFrame, h5py.File]:
    """Loads trainval+test PV timeseries into one dataframe with an 'idx'/'split'
    pointer back into the HDF5 file (images are NOT loaded into memory here)."""
    h5file = h5py.File(cfg.hdf5_path, "r")

    times_train = np.load(cfg.times_train_path, allow_pickle=True)
    times_test = np.load(cfg.times_test_path, allow_pickle=True)

    df_train = pd.DataFrame({
        "time": pd.to_datetime(times_train),
        "pv": h5file["trainval"]["pv_log"][:],
    })
    df_train["idx"] = df_train.index
    df_train["split"] = "trainval"

    df_test = pd.DataFrame({
        "time": pd.to_datetime(times_test),
        "pv": h5file["test"]["pv_log"][:],
    })
    df_test["idx"] = df_test.index
    df_test["split"] = "test"

    df_all = pd.concat([df_train, df_test], ignore_index=True)
    df_all = df_all.sort_values("time").reset_index(drop=True)

    df_all["hour"] = df_all["time"].dt.hour
    df_all["minute"] = df_all["time"].dt.minute
    df_all["date"] = df_all["time"].dt.date
    df_all["month"] = df_all["time"].dt.month

    return df_all, h5file


def get_sky_image(h5file: h5py.File, row: pd.Series) -> np.ndarray:
    idx = int(row["idx"])
    split = row["split"]
    return h5file[split]["images_log"][idx]


# --------------------------------------------------------------------------
# 2. EDA plots (optional — call individually, not run by default)
# --------------------------------------------------------------------------

def plot_day(df: pd.DataFrame, target_day: str) -> None:
    day_df = df[df["date"] == pd.to_datetime(target_day).date()]

    plt.figure(figsize=(15, 5))
    plt.plot(day_df["time"], day_df["pv"])
    plt.xlabel("Time")
    plt.ylabel("PV Output")
    plt.title(f"PV Output on {target_day}")
    plt.gca().xaxis.set_major_locator(mdates.HourLocator(interval=1))
    plt.gca().xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    plt.xticks(rotation=45)
    plt.grid(True)
    plt.tight_layout()
    plt.show()


def plot_daily_and_hourly_avg(df: pd.DataFrame) -> None:
    daily_avg = df.groupby("date")["pv"].mean()
    plt.figure(figsize=(18, 5))
    plt.plot(daily_avg.index, daily_avg.values)
    plt.xlabel("Date")
    plt.ylabel("Average PV")
    plt.title("Daily avg PV")
    plt.grid(True)
    plt.tight_layout()
    plt.show()

    hourly_avg = df.groupby("hour")["pv"].mean()
    plt.figure(figsize=(10, 5))
    plt.plot(hourly_avg.index, hourly_avg.values)
    plt.xlabel("Hour")
    plt.ylabel("Avg PV")
    plt.title("Avg PV by hour")
    plt.grid(True)
    plt.tight_layout()
    plt.show()

    pivot = df.pivot_table(values="pv", index="month", columns="hour", aggfunc="mean")
    plt.figure(figsize=(12, 6))
    sns.heatmap(pivot)
    plt.title("Average PV by Month and Hour")
    plt.tight_layout()
    plt.show()


def show_low_high_pv_images(df: pd.DataFrame, h5file: h5py.File) -> None:
    low_row = df.nsmallest(1, "pv").iloc[0]
    high_row = df.nlargest(1, "pv").iloc[0]

    low_img = get_sky_image(h5file, low_row)
    high_img = get_sky_image(h5file, high_row)

    fig, axes = plt.subplots(1, 2, figsize=(10, 5))
    axes[0].imshow(low_img)
    axes[0].set_title(f"Low PV = {low_row['pv']}")
    axes[0].axis("off")
    axes[1].imshow(high_img)
    axes[1].set_title(f"High PV = {high_row['pv']}")
    axes[1].axis("off")
    plt.tight_layout()
    plt.show()


# --------------------------------------------------------------------------
# 3. GOES download + temporal matching to SKIPD/PV rows
# --------------------------------------------------------------------------

def download_goes_day(cfg: Config, target_day: str, start_hour: int = 6, end_hour: int = 21) -> pd.DataFrame:
    """Downloads one day of GOES scans and returns goes2go's file index
    (goes_time, goes_file) ready for merge_asof matching."""
    from goes2go import GOES

    G = GOES(satellite=cfg.satellite_number, product=cfg.product, domain=cfg.domain)
    files = G.timerange(
        start=f"{target_day} {start_hour:02d}:00",
        end=f"{target_day} {end_hour:02d}:00",
        save_dir=str(cfg.goes_cache_dir),
    )

    goes_df = files[["start", "file"]].rename(columns={"start": "goes_time", "file": "goes_file"})
    goes_df["goes_time"] = pd.to_datetime(goes_df["goes_time"])
    return goes_df


def match_pv_to_goes(pv_day_df: pd.DataFrame, goes_df: pd.DataFrame) -> pd.DataFrame:
    """Nearest-neighbour match: each PV/sky-image timestamp gets the closest
    GOES scan (typically within 300s, since GOES scans every ~5 min)."""
    matched = pd.merge_asof(
        pv_day_df.sort_values("time"),
        goes_df.sort_values("goes_time"),
        left_on="time",
        right_on="goes_time",
        direction="nearest",
    )
    matched["time_diff_sec"] = (matched["time"] - matched["goes_time"]).abs().dt.total_seconds()
    return matched


def build_matched_day(cfg: Config, df: pd.DataFrame, target_day: str) -> pd.DataFrame:
    pv_day_df = df[df["date"] == pd.to_datetime(target_day).date()].sort_values("time").copy()
    goes_df = download_goes_day(cfg, target_day)
    matched_df = match_pv_to_goes(pv_day_df, goes_df)
    return matched_df


# --------------------------------------------------------------------------
# 4. Reusable feature-extraction function (validated on Aug 10 2019)
# --------------------------------------------------------------------------

def find_pixel_index(ds: xr.Dataset, lat: float, lon: float) -> tuple[int, int]:
    """Projects a lat/lon onto the GOES fixed-grid and returns (x_idx, y_idx)."""
    from pyproj import Proj

    sat_h = ds["goes_imager_projection"].attrs["perspective_point_height"]
    sat_lon_0 = ds["goes_imager_projection"].attrs["longitude_of_projection_origin"]
    sweep = ds["goes_imager_projection"].attrs["sweep_angle_axis"]

    proj = Proj(proj="geos", h=sat_h, lon_0=sat_lon_0, sweep=sweep)
    x_m, y_m = proj(lon, lat)
    x_target, y_target = x_m / sat_h, y_m / sat_h

    x_idx = int(np.abs(ds.x.values - x_target).argmin())
    y_idx = int(np.abs(ds.y.values - y_target).argmin())
    return x_idx, y_idx


def extract_patch_features(
    ds: xr.Dataset,
    goes_time,
    site_lat: float,
    site_lon: float,
    x_idx: int,
    y_idx: int,
    patch_size: int,
) -> dict:
    """DQF-masks bad pixels, extracts reflective + IR band stats for one patch,
    and normalizes reflectance by cos(solar zenith) since raw Band 2 is
    unusable near sunrise/sunset without this (see notebook investigation)."""
    features: dict = {}

    solpos = solarposition.get_solarposition(
        pd.Timestamp(goes_time, tz="UTC"), site_lat, site_lon
    )
    zenith_deg = float(solpos["zenith"].iloc[0])
    cos_zenith = np.cos(np.radians(zenith_deg))
    features["solar_zenith_deg"] = zenith_deg

    y_slice = slice(y_idx - patch_size, y_idx + patch_size)
    x_slice = slice(x_idx - patch_size, x_idx + patch_size)

    for band, dqf in zip(REFLECTIVE_BANDS, REFLECTIVE_DQF):
        arr = ds[band].isel(y=y_slice, x=x_slice).values
        flag = ds[dqf].isel(y=y_slice, x=x_slice).values
        arr = np.where(flag == 0, arr, np.nan)

        arr_norm = arr / cos_zenith if cos_zenith > 0.05 else np.full_like(arr, np.nan)

        name = band.replace("CMI_", "")
        features[f"{name}_mean"] = float(np.nanmean(arr_norm))
        features[f"{name}_std"] = float(np.nanstd(arr_norm))
        features[f"{name}_valid_frac"] = float(np.mean(flag == 0))

    ir_arr = ds[IR_BAND].isel(y=y_slice, x=x_slice).values
    ir_flag = ds[IR_DQF].isel(y=y_slice, x=x_slice).values
    ir_arr = np.where(ir_flag == 0, ir_arr, np.nan)

    features["C13_mean"] = float(np.nanmean(ir_arr))
    features["C13_std"] = float(np.nanstd(ir_arr))
    features["C13_valid_frac"] = float(np.mean(ir_flag == 0))

    return features


def build_feature_dataset(cfg: Config, matched_df: pd.DataFrame) -> pd.DataFrame:
    """Applies extract_patch_features across every matched row, grouping by
    goes_file so each satellite file is opened exactly once."""
    all_features = []
    x_idx = y_idx = None

    for goes_file, group in matched_df.groupby("goes_file"):
        goes_path = cfg.goes_cache_dir / goes_file
        with xr.open_dataset(goes_path) as ds:
            if x_idx is None:
                x_idx, y_idx = find_pixel_index(ds, cfg.site_lat, cfg.site_lon)

            for _, row in group.iterrows():
                feats = extract_patch_features(
                    ds, row["goes_time"], cfg.site_lat, cfg.site_lon,
                    x_idx, y_idx, cfg.patch_size,
                )
                feats["idx"] = row["idx"]
                all_features.append(feats)

    features_df = pd.DataFrame(all_features)
    features_df = features_df.merge(matched_df[["idx", "pv", "time"]], on="idx")
    return features_df


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-day", default="2019-08-10")
    parser.add_argument("--data-dir", default=os.environ.get("PV_DATA_DIR", "./data"))
    parser.add_argument("--plot", action="store_true", help="show EDA plots")
    args = parser.parse_args()

    cfg = Config(data_dir=Path(args.data_dir))

    df, h5file = load_pv_dataframe(cfg)
    print(f"Loaded {len(df)} PV samples spanning {df['time'].min()} .. {df['time'].max()}")

    if args.plot:
        plot_day(df, args.target_day)
        plot_daily_and_hourly_avg(df)
        show_low_high_pv_images(df, h5file)

    matched_df = build_matched_day(cfg, df, args.target_day)
    matched_df.to_csv(cfg.matched_csv_path, index=False)
    print(f"Matched {len(matched_df)} rows for {args.target_day} "
          f"(mean time diff {matched_df['time_diff_sec'].mean():.1f}s)")

    features_df = build_feature_dataset(cfg, matched_df)
    features_df.to_parquet(cfg.features_out_path, index=False)
    print(f"Wrote {len(features_df)} feature rows to {cfg.features_out_path}")

    h5file.close()


if __name__ == "__main__":
    main()
