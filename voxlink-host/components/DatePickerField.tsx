import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, FlatList, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";

const ACCENT = "#A00EE7";
const DARK = "#111329";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const today = new Date();
export const DOB_MIN_DATE = new Date(today.getFullYear() - 70, 0, 1);
export const DOB_MAX_DATE = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());

export function formatDobDisplay(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

export function formatDobApi(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${y}-${m}-${d}`;
}

export function displayToDate(display: string): Date | null {
  if (!display || !display.includes("/")) return null;
  const [d, m, y] = display.split("/").map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

// ── Scroll column for web picker ─────────────────────────────────────────────
function ScrollColumn({
  items, selectedIndex, onSelect,
}: { items: string[]; selectedIndex: number; onSelect: (i: number) => void }) {
  const ITEM_H = 48;
  const ref = React.useRef<FlatList<string>>(null);

  React.useEffect(() => {
    setTimeout(() => {
      ref.current?.scrollToIndex({ index: selectedIndex, animated: false, viewPosition: 0.5 });
    }, 100);
  }, []);

  return (
    <FlatList
      ref={ref}
      data={items}
      keyExtractor={(_, i) => String(i)}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      style={{ height: ITEM_H * 5, width: "100%" }}
      contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
      getItemLayout={(_, i) => ({ length: ITEM_H, offset: ITEM_H * i, index: i })}
      onMomentumScrollEnd={(e) => {
        const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
        onSelect(Math.max(0, Math.min(i, items.length - 1)));
      }}
      renderItem={({ item, index }) => (
        <TouchableOpacity
          onPress={() => {
            onSelect(index);
            ref.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
          }}
          activeOpacity={0.7}
          style={[c.colItem, index === selectedIndex && c.colItemActive]}
        >
          <Text style={[c.colItemTxt, index === selectedIndex && c.colItemTxtActive]}>
            {item}
          </Text>
        </TouchableOpacity>
      )}
    />
  );
}

// ── Web bottom-sheet picker ───────────────────────────────────────────────────
function WebDateSheet({
  visible, initial, onDone, onCancel,
}: { visible: boolean; initial: Date; onDone: (d: Date) => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const years: string[] = [];
  for (let y = today.getFullYear() - 18; y >= today.getFullYear() - 70; y--) {
    years.push(String(y));
  }
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

  const [dayIdx, setDayIdx] = useState(initial.getDate() - 1);
  const [monIdx, setMonIdx] = useState(initial.getMonth());
  const [yearIdx, setYearIdx] = useState(
    Math.max(0, years.indexOf(String(initial.getFullYear())))
  );

  const handleDone = () => {
    const y = parseInt(years[yearIdx], 10);
    const m = monIdx;
    const dMax = new Date(y, m + 1, 0).getDate();
    const d = Math.min(dayIdx + 1, dMax);
    onDone(new Date(y, m, d));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <TouchableOpacity style={c.overlay} activeOpacity={1} onPress={onCancel} />
      <View style={[c.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={c.sheetHandle} />
        <View style={c.sheetHeader}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={c.sheetCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={c.sheetTitle}>Date of Birth</Text>
          <TouchableOpacity onPress={handleDone}>
            <Text style={c.sheetDone}>Done</Text>
          </TouchableOpacity>
        </View>
        <View style={c.pickerRow}>
          <View style={c.colWrap}>
            <Text style={c.colLabel}>Day</Text>
            <View style={c.colBox}>
              <View style={c.selHighlight} />
              <ScrollColumn items={days} selectedIndex={dayIdx} onSelect={setDayIdx} />
            </View>
          </View>
          <View style={[c.colWrap, { flex: 2 }]}>
            <Text style={c.colLabel}>Month</Text>
            <View style={c.colBox}>
              <View style={c.selHighlight} />
              <ScrollColumn items={MONTHS} selectedIndex={monIdx} onSelect={setMonIdx} />
            </View>
          </View>
          <View style={c.colWrap}>
            <Text style={c.colLabel}>Year</Text>
            <View style={c.colBox}>
              <View style={c.selHighlight} />
              <ScrollColumn items={years} selectedIndex={yearIdx} onSelect={setYearIdx} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Main exported component ───────────────────────────────────────────────────
interface DatePickerFieldProps {
  value: string;
  onChange: (display: string, date: Date) => void;
  placeholder?: string;
  fieldStyle?: object;
}

export function DatePickerField({
  value, onChange, placeholder = "Date of birth (tap to pick)", fieldStyle,
}: DatePickerFieldProps) {
  const isWeb = Platform.OS === "web";
  const parsed = displayToDate(value);
  const [dobDate, setDobDate] = useState<Date>(parsed ?? DOB_MAX_DATE);
  const [showNative, setShowNative] = useState(false);
  const [showWeb, setShowWeb] = useState(false);

  const openPicker = () => {
    if (isWeb) setShowWeb(true);
    else setShowNative(true);
  };

  const onNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowNative(false);
    if (event.type === "dismissed") return;
    if (selected) {
      setDobDate(selected);
      onChange(formatDobDisplay(selected), selected);
    }
  };

  return (
    <View>
      <TouchableOpacity onPress={openPicker} activeOpacity={0.8} style={[c.field, fieldStyle]}>
        <Feather name="calendar" size={18} color={value ? ACCENT : "#84889F"} />
        <Text style={[c.fieldTxt, !value && c.fieldPlaceholder]}>
          {value || placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color="#84889F" />
      </TouchableOpacity>

      {!isWeb && showNative && (
        <View style={Platform.OS === "ios" ? c.iosWrap : undefined}>
          <DateTimePicker
            value={dobDate}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={onNativeChange}
            maximumDate={DOB_MAX_DATE}
            minimumDate={DOB_MIN_DATE}
            textColor={DARK}
            accentColor={ACCENT}
          />
          {Platform.OS === "ios" && (
            <TouchableOpacity style={c.iosDone} onPress={() => setShowNative(false)}>
              <Text style={c.iosDoneTxt}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {isWeb && (
        <WebDateSheet
          visible={showWeb}
          initial={dobDate}
          onDone={(d) => {
            setDobDate(d);
            onChange(formatDobDisplay(d), d);
            setShowWeb(false);
          }}
          onCancel={() => setShowWeb(false)}
        />
      )}
    </View>
  );
}

const c = StyleSheet.create({
  field: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, borderColor: "#E8EAF0",
    backgroundColor: "#F8F9FC", paddingHorizontal: 16, paddingVertical: 14,
  },
  fieldTxt: { flex: 1, fontSize: 15, fontFamily: "Poppins_400Regular", color: DARK },
  fieldPlaceholder: { color: "#84889F" },
  iosWrap: {
    backgroundColor: "#F8F9FC", borderRadius: 14, borderWidth: 1,
    borderColor: "#E8EAF0", overflow: "hidden",
  },
  iosDone: {
    alignItems: "flex-end", paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: "#E8EAF0",
  },
  iosDoneTxt: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: ACCENT },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 16,
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: "#E0E0E0", borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sheetCancel: { fontSize: 15, fontFamily: "Poppins_400Regular", color: "#84889F" },
  sheetTitle: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: DARK },
  sheetDone: { fontSize: 15, fontFamily: "Poppins_600SemiBold", color: ACCENT },
  pickerRow: { flexDirection: "row", gap: 8 },
  colWrap: { flex: 1, alignItems: "center" },
  colLabel: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "#84889F", marginBottom: 6 },
  colBox: { width: "100%", overflow: "hidden", position: "relative" },
  selHighlight: {
    position: "absolute", top: "50%", left: 0, right: 0,
    height: 48, marginTop: -24,
    backgroundColor: "#F4E8FD", borderRadius: 10, zIndex: 0,
  },
  colItem: { height: 48, justifyContent: "center", alignItems: "center" },
  colItemActive: {},
  colItemTxt: { fontSize: 15, fontFamily: "Poppins_400Regular", color: "#84889F" },
  colItemTxtActive: { fontSize: 16, fontFamily: "Poppins_600SemiBold", color: ACCENT },
});
