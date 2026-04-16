import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../models/incident.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_container.dart';
import '../widgets/gradient_scaffold.dart';
import '../widgets/shared_widgets.dart';
import 'home_screen.dart';

class IncidentsScreen extends StatefulWidget {
  const IncidentsScreen({super.key});

  @override
  State<IncidentsScreen> createState() => _IncidentsScreenState();
}

class _IncidentsScreenState extends State<IncidentsScreen> {
  String _filter = 'All';
  final _filters = const ['All', 'Active', 'Resolved'];

  @override
  Widget build(BuildContext context) {
    List<Incident> list = MockData.incidents;
    if (_filter == 'Active') {
      list = list
          .where((i) => i.status != IncidentStatus.resolved)
          .toList();
    } else if (_filter == 'Resolved') {
      list = list
          .where((i) => i.status == IncidentStatus.resolved)
          .toList();
    }
    return GradientScaffold(
      appBar: AppBar(title: const Text('My incidents')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg),
            child: GlassContainer(
              padding: const EdgeInsets.all(4),
              borderRadius: AppRadius.pill,
              child: Row(
                children: _filters.map((f) {
                  final selected = f == _filter;
                  return Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _filter = f),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: selected
                              ? AppColors.accent.withOpacity(0.22)
                              : Colors.transparent,
                          borderRadius:
                              BorderRadius.circular(AppRadius.pill),
                          border: selected
                              ? Border.all(color: AppColors.accent)
                              : null,
                        ),
                        child: Center(
                          child: Text(
                            f,
                            style: GoogleFonts.inter(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              color: selected
                                  ? AppColors.accent
                                  : AppColors.textSecondary,
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, 0, AppSpacing.lg, 80),
              itemCount: list.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppSpacing.md),
              itemBuilder: (_, i) => IncidentCard(incident: list[i]),
            ),
          ),
        ],
      ),
    );
  }
}
